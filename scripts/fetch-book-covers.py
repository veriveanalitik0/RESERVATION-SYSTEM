#!/usr/bin/env python3
"""AI LAB Kitap Listesi.xlsx → kitap verisi + internetten kapak görseli → SQL/JSON.

Kapak: önce Google Books (TR kapsamı iyi), sonra Open Library fallback. Bulunamazsa
cover_image_url NULL (UI placeholder gösterir). Çıktı: /tmp/books_seed.sql + /tmp/books.json
"""
import zipfile, re, json, time, sys, urllib.parse, urllib.request, urllib.error
# nosemgrep: python.lang.security.use-defused-xml.use-defused-xml
# Güvenli: yalnız GÜVENİLİR yerel dosyayı (kullanıcının xlsx'i) parse eden dev-only
# araç; Docker image'ına kopyalanmaz (attack surface değil). ET, Py 3.7.1+'da dış
# varlık (XXE) çözmez. defusedxml ek bağımlılık olduğundan tercih edilmedi.
import xml.etree.ElementTree as ET  # noqa: S314

XLSX = "AI LAB Kitap Listesi.xlsx"
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def read_rows():
    z = zipfile.ZipFile(XLSX)
    shared = []
    try:
        sst = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in sst.findall(f'{NS}si'):
            shared.append(''.join(t.text or '' for t in si.iter(f'{NS}t')))
    except KeyError:
        pass
    names = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml', n))
    sheet = ET.fromstring(z.read(names[0]))
    out = []
    for row in sheet.iter(f'{NS}row'):
        cells = {}
        for c in row.findall(f'{NS}c'):
            ref = c.get('r'); t = c.get('t'); v = c.find(f'{NS}v'); isn = c.find(f'{NS}is')
            val = ''
            if t == 's' and v is not None:
                val = shared[int(v.text)]
            elif isn is not None:
                val = ''.join(x.text or '' for x in isn.iter(f'{NS}t'))
            elif v is not None:
                val = v.text or ''
            cells[re.match(r'[A-Z]+', ref).group()] = val
        out.append(cells)
    return out


def parse_books(rows):
    books = []
    for r in rows:
        a = (r.get('A') or '').strip()
        if not re.fullmatch(r'\d+', a):       # yalnız numaralı kitap satırları
            continue
        title = (r.get('B') or '').strip()
        author = (r.get('C') or '').strip()
        if not title:
            continue
        books.append({
            'num': int(a),
            'title': title,
            'author': author,
            'category': (r.get('D') or '').strip(),
            'level': (r.get('E') or '').strip(),
            'lang': (r.get('F') or '').strip(),
            'publisher': (r.get('G') or '').strip(),
            'year': (r.get('I') or '').strip(),
            'tag': (r.get('J') or '').strip(),
            'note': (r.get('K') or '').strip(),
        })
    return books


def http_json(url, timeout=12):
    req = urllib.request.Request(url, headers={'User-Agent': 'klab-library/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


_google_off = [False]  # 429 sonrası Google'ı kapat (retry-storm yok)


def google_cover(title, author):
    if _google_off[0]:
        return None
    q = f'intitle:{title}'
    if author and author.lower() != 'kolektif':
        first_author = re.split(r'[&,]', author)[0].strip()
        q += f'+inauthor:{first_author}'
    url = 'https://www.googleapis.com/books/v1/volumes?' + urllib.parse.urlencode(
        {'q': q, 'maxResults': 1, 'country': 'US'})
    try:
        d = http_json(url)
        items = d.get('items') or []
        if items:
            links = items[0].get('volumeInfo', {}).get('imageLinks', {})
            img = links.get('thumbnail') or links.get('smallThumbnail')
            if img:
                return img.replace('http://', 'https://').replace('&edge=curl', '')
    except urllib.error.HTTPError as e:
        if e.code == 429:
            _google_off[0] = True
            print("  google 429 → Google kapatıldı (OL'ye güveniliyor)", file=sys.stderr)
        else:
            print(f"  google err: {e}", file=sys.stderr)
    except Exception as e:
        print(f"  google err: {e}", file=sys.stderr)
    return None


def openlib_cover(title, author):
    url = 'https://openlibrary.org/search.json?' + urllib.parse.urlencode(
        {'title': title, 'author': author or '', 'limit': 1, 'fields': 'cover_i'})
    try:
        d = http_json(url)
        docs = d.get('docs') or []
        if docs and docs[0].get('cover_i'):
            return f"https://covers.openlibrary.org/b/id/{docs[0]['cover_i']}-L.jpg"
    except Exception as e:
        print(f"  openlib err: {e}", file=sys.stderr)
    return None


def main():
    books = parse_books(read_rows())
    print(f"{len(books)} kitap parse edildi.", file=sys.stderr)
    found = 0
    for b in books:
        # Open Library primary (toleranslı; İng./referans kitaplarda iyi kapsam):
        # title+author → title-only (yazar adı farkı toleransı) → Google (son çare).
        cover = (openlib_cover(b['title'], b['author'])
                 or openlib_cover(b['title'], '')
                 or google_cover(b['title'], b['author']))
        b['cover'] = cover
        if cover:
            found += 1
        print(f"[{b['num']:>2}] {'OK ' if cover else '-- '} {b['title'][:50]}", file=sys.stderr)
        time.sleep(0.8)  # OL'ye nazik
    print(f"Kapak bulundu: {found}/{len(books)}", file=sys.stderr)

    json.dump(books, open('/tmp/books.json', 'w'), ensure_ascii=False, indent=1)

    def esc(s):
        return (s or '').replace("'", "''")

    def copies(tag):
        t = (tag or '').lower()
        if 'sahaf' in t or 'dijital' in t:
            return 1
        return 2

    lines = ["-- AI LAB Kütüphanesi — 75 kitap (Excel'den; kapaklar Google Books/Open Library)",
             "DELETE FROM book_loans; DELETE FROM books;"]
    for b in books:
        bid = f"book_xl_{b['num']:03d}"
        desc_parts = [p for p in [b['note'], f"{b['publisher']}" if b['publisher'] else '',
                                  f"{b['year']}" if b['year'] else ''] if p]
        desc = ' · '.join(desc_parts)
        cov = f"'{esc(b['cover'])}'" if b['cover'] else 'NULL'
        n = copies(b['tag'])
        lines.append(
            f"INSERT INTO books (id,title,author,category,description,cover_image_url,total_copies,available_copies,is_active) "
            f"VALUES ('{bid}','{esc(b['title'])}','{esc(b['author'])}','{esc(b['category'])}',"
            f"'{esc(desc)}',{cov},{n},{n},1) ON CONFLICT (id) DO UPDATE SET "
            f"title=EXCLUDED.title,author=EXCLUDED.author,category=EXCLUDED.category,"
            f"description=EXCLUDED.description,cover_image_url=EXCLUDED.cover_image_url;")
    open('/tmp/books_seed.sql', 'w').write('\n'.join(lines) + '\n')
    print("YAZILDI: /tmp/books_seed.sql + /tmp/books.json", file=sys.stderr)


if __name__ == '__main__':
    main()
