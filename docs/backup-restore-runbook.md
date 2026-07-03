# Yedekleme & Geri Yükleme Runbook'u

## Mimari

Production veritabanı yedekleri `postgres-backup` sidecar'ı ile alınır
(`docker-compose.prod.yml`, image: `prodrigestivill/postgres-backup-local:16`).

- **Zamanlama:** Her gece 02:30 (Europe/Istanbul)
- **Format:** `pg_dump` custom format (`.sql.gz`)
- **Saklama:** 7 günlük + 4 haftalık + 6 aylık
- **Konum:** `pgbackups` named volume → container içinde `/backups`

> ⚠️ **Off-site kopya zorunludur.** `pgbackups` volume'u aynı host'tadır; host
> kaybında yedek de gider. Aşağıdaki "Off-site senkron" adımını kurmadan bu
> kurulum tamamlanmış sayılmaz.

## Yedeklerin durumunu kontrol etme

```bash
# Sidecar sağlıklı mı?
docker compose -p klab-randevu-prod ps postgres-backup

# Mevcut yedek dosyaları
docker compose -p klab-randevu-prod exec postgres-backup ls -lah /backups/daily
```

## Elle yedek alma (deploy öncesi önerilir)

```bash
docker compose -p klab-randevu-prod exec postgres-backup /backup.sh
```

## Geri yükleme (RESTORE)

> Tatbikat: aşağıdaki geri-yükleme prosedürünü düzenli (en az ayda bir) bir test
> ortamında elle çalıştırıp yedeklerin gerçekten geri yüklenebildiğini doğrulayın.

1. Uygulamayı durdurun (DB'ye yazan kalmasın):

   ```bash
   docker compose -p klab-randevu-prod stop backend
   ```

2. Geri yüklenecek dosyayı belirleyin:

   ```bash
   docker compose -p klab-randevu-prod exec postgres-backup ls /backups/daily
   ```

3. Yedeği geri yükleyin (yedek `--clean --if-exists` ile alındığından mevcut
   nesneleri düşürüp yeniden oluşturur):

   ```bash
   docker compose -p klab-randevu-prod exec postgres-backup sh -c \
     'zcat /backups/daily/<DOSYA>.sql.gz | psql -h postgres -U $POSTGRES_USER -d $POSTGRES_DB'
   ```

4. Uygulamayı başlatın ve doğrulayın:

   ```bash
   docker compose -p klab-randevu-prod start backend
   curl -fsS http://localhost/api/readiness
   ```

## Off-site senkron (kurulması gereken)

`pgbackups` volume'unu harici depoya kopyalayan bir host cron'u ekleyin, örn:

```bash
# /etc/cron.d/klab-backup-offsite — her gece 03:30 (yedek bittikten sonra)
30 3 * * * root docker run --rm -v klab-randevu-prod_pgbackups:/backups:ro \
  -v /mnt/offsite:/target alpine sh -c 'cp -a /backups/. /target/klab/'
```

S3/objekt depo için `rclone` veya `aws s3 sync` aynı volume mount'uyla kullanılabilir.

## Felaket senaryoları

| Senaryo | Prosedür |
| --- | --- |
| Yanlış veri silindi | İlgili günün yedeğini ayrı bir DB'ye restore edip veriyi çekin |
| `pgdata` volume bozuldu | Volume'u silin, postgres'i başlatın, son yedeği restore edin |
| Host tamamen kayboldu | Yeni host + off-site yedekten restore (off-site kurulduysa) |

## Uygulama-içi `backup.service`

Backend'deki `backup.service.ts` PostgreSQL için **bilinçli no-op**'tur — gerçek
yedekleme bu sidecar'ın sorumluluğudur. `GET /api/admin/backup` listesi yalnız
bilgilendirme amaçlıdır.
