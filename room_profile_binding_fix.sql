-- ARTI EKSİ: profilin oda içindeki oyuncu slotuna kesin bağlanması.
-- Supabase SQL Editor'de bu dosyanın tamamını bir kez çalıştır.

CREATE OR REPLACE FUNCTION public.bind_room_profile(
  p_player_token uuid,
  p_profile_id uuid,
  p_profile_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_room_code text;
  v_player_number integer;
BEGIN
  IF p_player_token IS NULL OR p_profile_id IS NULL OR COALESCE(p_profile_token, '') = '' THEN
    RAISE EXCEPTION 'Oyuncu veya profil bilgisi eksik.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.player_profiles p
    JOIN public.player_profile_secrets s ON s.profile_id = p.id
    WHERE p.id = p_profile_id
      AND s.token_hash = encode(digest(p_profile_token, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'Profil doğrulanamadı.';
  END IF;

  UPDATE public.game_rooms
  SET player1_profile_id = p_profile_id
  WHERE player1_id = p_player_token
  RETURNING room_code INTO v_room_code;

  IF FOUND THEN
    v_player_number := 1;
  ELSE
    UPDATE public.game_rooms
    SET player2_profile_id = p_profile_id
    WHERE player2_id = p_player_token
    RETURNING room_code INTO v_room_code;

    IF FOUND THEN
      v_player_number := 2;
    END IF;
  END IF;

  IF v_player_number IS NULL THEN
    RAISE EXCEPTION 'Bu oyuncu oturumu için aktif oda bulunamadı.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'room_code', v_room_code,
    'player', v_player_number,
    'profile_id', p_profile_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bind_room_profile(uuid, uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
