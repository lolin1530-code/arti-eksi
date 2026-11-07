-- ARTI EKSİ: İkili rekabet istatistikleri
-- Supabase SQL Editor'de bir kez çalıştır.
-- Profil oluşturulduktan sonra iki oyuncu arasında kaydedilmiş bütün ortak maçları sayar.

CREATE OR REPLACE FUNCTION public.get_rivalry_stats(
  p_id uuid,
  p_token text,
  p_opponent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_created_at timestamptz;
  v_opponent_created_at timestamptz;
  v_opponent_username text;
  v_my_wins integer := 0;
  v_opponent_wins integer := 0;
  v_draws integer := 0;
  v_total integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.player_profile_secrets s
    WHERE s.profile_id = p_id
      AND s.token_hash = encode(digest(p_token, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'Profil doğrulanamadı.';
  END IF;

  SELECT p.created_at
  INTO v_my_created_at
  FROM public.player_profiles p
  WHERE p.id = p_id;

  IF v_my_created_at IS NULL THEN
    RAISE EXCEPTION 'Profil bulunamadı.';
  END IF;

  SELECT p.created_at, p.username
  INTO v_opponent_created_at, v_opponent_username
  FROM public.player_profiles p
  WHERE p.id = p_opponent_id;

  IF v_opponent_created_at IS NULL THEN
    RAISE EXCEPTION 'Karşılaştırılacak profil bulunamadı.';
  END IF;

  SELECT
    count(*) FILTER (WHERE mine.won IS TRUE)::integer,
    count(*) FILTER (WHERE mine.won IS FALSE)::integer,
    count(*) FILTER (WHERE mine.won IS NULL)::integer,
    count(*)::integer
  INTO v_my_wins, v_opponent_wins, v_draws, v_total
  FROM public.player_match_results mine
  JOIN public.player_match_results theirs
    ON theirs.match_key = mine.match_key
   AND theirs.profile_id = p_opponent_id
  WHERE mine.profile_id = p_id
    AND mine.created_at >= v_my_created_at
    AND theirs.created_at >= v_opponent_created_at;

  RETURN jsonb_build_object(
    'my_wins', coalesce(v_my_wins, 0),
    'opponent_wins', coalesce(v_opponent_wins, 0),
    'draws', coalesce(v_draws, 0),
    'total', coalesce(v_total, 0),
    'opponent_username', v_opponent_username
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_rivalry_stats(uuid, text, uuid) TO anon, authenticated;
