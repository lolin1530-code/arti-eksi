-- ARTI EKSİ: Başarım unvanı sistemi
-- Supabase SQL Editor'de bir kez çalıştır.

ALTER TABLE public.player_profiles
ADD COLUMN IF NOT EXISTS equipped_title_key text;

CREATE OR REPLACE FUNCTION public.set_profile_title(
  p_profile_id uuid,
  p_profile_token text,
  p_achievement_key text DEFAULT NULL
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

  IF p_achievement_key IS NOT NULL AND NOT (
    (p_achievement_key = 'first_blood_1' AND EXISTS (SELECT 1 FROM public.player_profiles WHERE id = p_profile_id AND wins >= 1))
    OR (p_achievement_key = 'first_blood_5' AND EXISTS (SELECT 1 FROM public.player_profiles WHERE id = p_profile_id AND wins >= 5))
    OR (p_achievement_key = 'first_blood_10' AND EXISTS (SELECT 1 FROM public.player_profiles WHERE id = p_profile_id AND wins >= 10))
    OR (p_achievement_key = 'first_blood_37' AND EXISTS (SELECT 1 FROM public.player_profiles WHERE id = p_profile_id AND wins >= 37))
    OR (p_achievement_key = 'first_blood_62' AND EXISTS (SELECT 1 FROM public.player_profiles WHERE id = p_profile_id AND wins >= 62))
    OR (p_achievement_key = 'first_blood_100' AND EXISTS (SELECT 1 FROM public.player_profiles WHERE id = p_profile_id AND wins >= 100))
    OR (p_achievement_key = 'streak_5' AND EXISTS (SELECT 1 FROM public.player_profiles WHERE id = p_profile_id AND streak >= 5))
    OR EXISTS (
      SELECT 1 FROM public.player_achievements a
      WHERE a.profile_id = p_profile_id
        AND a.achievement_key = p_achievement_key
    )
  ) THEN
    RAISE EXCEPTION 'Bu başarım henüz kazanılmamış.';
  END IF;

  UPDATE public.player_profiles
  SET equipped_title_key = p_achievement_key
  WHERE id = p_profile_id;

  RETURN jsonb_build_object('success', true, 'equipped_title_key', p_achievement_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profile_title(p_profile_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'profile_id', p.id,
    'equipped_title_key', p.equipped_title_key
  )
  FROM public.player_profiles p
  WHERE p.id = p_profile_id;
$$;

GRANT EXECUTE ON FUNCTION public.set_profile_title(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_title(uuid) TO anon, authenticated;
