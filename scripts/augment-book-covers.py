#!/usr/bin/env python3
"""Kapağı bulunamayan kitaplar için 2. geçiş: Google Books (yavaş tempo + 429 backoff).
Mevcut /tmp/books.json'u okur, eksikleri doldurur, /tmp/books.json + /tmp/books_seed.sql'i yeniden yazar.
"""
import json, time, sys, re, urllib.parse, urllib.request, urllib.error

books = json.load(open('/tmp/books.json'))


def google_cover(title, author):
    q = f'intitle:{title}'
    if author and author.lower() != 'kolektif':
        q += f'+inauthor:{re.split(r"[&,]", author)[0].strip()}'
    url = 'https://www.googleapis.com/books/v1/volumes?' + urllib.parse.urlencode(
        {'q': q, 'maxResults': 1, 'country': 'US'})
    req = urllib.request.Request(url, headers={'User-Agent': 'klab-library/1.0'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        d = json.loads(resp.read().decode('utf-8'))
    items = d.get('items') or []
    if items:
        links = items[0].get('volumeInfo', {}).get('imageLinks', {})
        img = links.get('thumbnail') or links.get('smallThumbnail')
        if img:
            return img.replace('http://', 'https://').replace('&edge=curl', '')
    return None


missing = [b for b in books if not b.get('cover')]
print(f"{len(missing)} eksik kapak için Google 2. geçiş...", file=sys.stderr)
added = 0
backoff_used = 0
for b in missing:
    for attempt in range(2):
        try:
            c = google_cover(b['title'], b['author'])
            if c:
                b['cover'] = c
                added += 1
                print(f"  + {b['title'][:45]}", file=sys.stderr)
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt == 0 and backoff_used < 3:
                backoff_used += 1
                print("  429 → 30s bekle", file=sys.stderr)
                time.sleep(30)
                continue
            print(f"  -- {b['title'][:40]} ({e.code})", file=sys.stderr)
            break
        except Exception as e:
            print(f"  err {e}", file=sys.stderr)
            break
    time.sleep(2.5)

total = sum(1 for b in books if b.get('cover'))
print(f"Eklenen: {added}; toplam kapak: {total}/{len(books)}", file=sys.stderr)
json.dump(books, open('/tmp/books.json', 'w'), ensure_ascii=False, indent=1)


def esc(s):
    return (s or '').replace("'", "''")


def copies(tag):
    t = (tag or '').lower()
    return 1 if ('sahaf' in t or 'dijital' in t) else 2


lines = ["-- AI LAB Kütüphanesi — 75 kitap (Excel; kapaklar Google Books/Open Library)",
         "DELETE FROM book_loans; DELETE FROM books;"]
for b in books:
    bid = f"book_xl_{b['num']:03d}"
    desc = ' · '.join(p for p in [b['note'], b['publisher'], str(b['year'])] if p)
    cov = f"'{esc(b['cover'])}'" if b.get('cover') else 'NULL'
    n = copies(b['tag'])
    lines.append(
        f"INSERT INTO books (id,title,author,category,description,cover_image_url,total_copies,available_copies,is_active) "
        f"VALUES ('{bid}','{esc(b['title'])}','{esc(b['author'])}','{esc(b['category'])}',"
        f"'{esc(desc)}',{cov},{n},{n},1) ON CONFLICT (id) DO UPDATE SET "
        f"title=EXCLUDED.title,author=EXCLUDED.author,category=EXCLUDED.category,"
        f"description=EXCLUDED.description,cover_image_url=EXCLUDED.cover_image_url;")
open('/tmp/books_seed.sql', 'w').write('\n'.join(lines) + '\n')
print("YAZILDI: /tmp/books_seed.sql + /tmp/books.json", file=sys.stderr)
