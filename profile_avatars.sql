-- ARTI EKSİ: Oyuncuların çizerek oluşturduğu profil fotoğrafları
-- Supabase SQL Editor'de bir kez çalıştır.

ALTER TABLE public.player_profiles
ADD COLUMN IF NOT EXISTS avatar_data text;

CREATE OR REPLACE FUNCTION public.set_profile_avatar(
  p_profile_id uuid,
  p_profile_token text,
  p_avatar_data text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.player_profile_secrets s
    WHERE s.profile_id = p_profile_id
      AND s.token_hash = encode(digest(p_profile_token, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'Profil doğrulanamadı.';
  END IF;

  IF p_avatar_data IS NOT NULL AND (
    length(p_avatar_data) > 180000
    OR p_avatar_data NOT LIKE 'data:image/png;base64,%'
  ) THEN
    RAISE EXCEPTION 'Geçersiz veya çok büyük PP dosyası.';
  END IF;

  UPDATE public.player_profiles
  SET avatar_data = p_avatar_data
  WHERE id = p_profile_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profile_avatar(p_profile_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('profile_id', p.id, 'avatar_data', p.avatar_data)
  FROM public.player_profiles p
  WHERE p.id = p_profile_id;
$$;

GRANT EXECUTE ON FUNCTION public.set_profile_avatar(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_avatar(uuid) TO anon, authenticated;
