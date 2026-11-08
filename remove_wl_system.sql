-- ARTI EKSİ: W/L sistemini tüm hesaplardan kaldır.
-- Hesaplar, kullanıcı adları, profiller, arkadaşlıklar ve BRAT başarımları korunur.
-- Yalnızca eski maç istatistik kayıtları temizlenir ve yeni W/L kayıt RPC'si kapatılır.

BEGIN;

DELETE FROM public.player_match_results;

UPDATE public.player_profiles
SET wins = 0,
    losses = 0,
    streak = 0;

DROP FUNCTION IF EXISTS public.record_room_profile_results(uuid, uuid, text, text);

NOTIFY pgrst, 'reload schema';

COMMIT;
