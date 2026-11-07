-- ARTI EKSİ: Kalıcı başarım sistemi
-- Supabase SQL Editor'de bir kez çalıştır.

CREATE TABLE IF NOT EXISTS public.player_achievements (
  profile_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  achievement_key text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  match_key text,
  PRIMARY KEY (profile_id, achievement_key)
);

ALTER TABLE public.player_achievements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_player_achievements(p_id uuid)
RETURNS TABLE (achievement_key text, unlocked_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.achievement_key, a.unlocked_at
  FROM public.player_achievements a
  WHERE a.profile_id = p_id
  ORDER BY a.unlocked_at, a.achievement_key;
$$;

CREATE OR REPLACE FUNCTION public.unlock_match_achievements(
  p_player_token uuid,
  p_profile_id uuid,
  p_profile_token text,
  p_match_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_player_number integer;
  v_winner integer;
  v_own_secret text;
  v_opponent_secret text;
  v_room_profile_id uuid;
  v_own_guess_count integer := 0;
  v_own_minus_four boolean := false;
  v_opponent_minus_four boolean := false;
  v_wins integer := 0;
  v_streak integer := 0;
  v_keys text[] := ARRAY[]::text[];
  v_new_keys text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.player_profile_secrets s
    WHERE s.profile_id = p_profile_id
      AND s.token_hash = encode(digest(p_profile_token, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'Profil doğrulanamadı.';
  END IF;

  SELECT
    r.id,
    CASE WHEN r.player1_id = p_player_token THEN 1 ELSE 2 END,
    r.winner,
    CASE WHEN r.player1_id = p_player_token THEN r.player1_secret ELSE r.player2_secret END,
    CASE WHEN r.player1_id = p_player_token THEN r.player2_secret ELSE r.player1_secret END,
    CASE WHEN r.player1_id = p_player_token THEN r.player1_profile_id ELSE r.player2_profile_id END
  INTO
    v_room_id, v_player_number, v_winner, v_own_secret, v_opponent_secret, v_room_profile_id
  FROM public.game_rooms r
  WHERE (r.player1_id = p_player_token OR r.player2_id = p_player_token)
    AND r.game_status = 'finished'
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Tamamlanmış maç bulunamadı.';
  END IF;

  IF v_room_profile_id IS DISTINCT FROM p_profile_id THEN
    RAISE EXCEPTION 'Profil bu oyuncu oturumuna bağlı değil.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.player_match_results mr
    WHERE mr.profile_id = p_profile_id
      AND mr.match_key = p_match_key
  ) THEN
    RAISE EXCEPTION 'Maç sonucu henüz kaydedilmemiş.';
  END IF;

  SELECT
    count(*) FILTER (WHERE g.player_number = v_player_number),
    coalesce(bool_or(g.player_number = v_player_number AND g.minus_count = 4), false),
    coalesce(bool_or(g.player_number <> v_player_number AND g.minus_count = 4), false)
  INTO v_own_guess_count, v_own_minus_four, v_opponent_minus_four
  FROM public.game_guesses g
  WHERE g.room_id = v_room_id;

  SELECT count(*)::integer
  INTO v_wins
  FROM public.player_match_results mr
  JOIN public.player_profiles p ON p.id = mr.profile_id
  WHERE mr.profile_id = p_profile_id
    AND mr.won IS TRUE
    AND mr.created_at >= p.created_at;

  SELECT p.streak
  INTO v_streak
  FROM public.player_profiles p
  WHERE p.id = p_profile_id;

  -- Galibiyet kilometre taşları: yalnızca profil oluşturulduktan sonraki maçlar.
  IF v_wins >= 1 THEN v_keys := array_append(v_keys, 'first_blood_1'); END IF;
  IF v_wins >= 5 THEN v_keys := array_append(v_keys, 'first_blood_5'); END IF;
  IF v_wins >= 10 THEN v_keys := array_append(v_keys, 'first_blood_10'); END IF;
  IF v_wins >= 37 THEN v_keys := array_append(v_keys, 'first_blood_37'); END IF;
  IF v_wins >= 41 THEN v_keys := array_append(v_keys, 'first_blood_41'); END IF;
  IF v_wins >= 62 THEN v_keys := array_append(v_keys, 'first_blood_62'); END IF;
  IF v_wins >= 100 THEN v_keys := array_append(v_keys, 'first_blood_100'); END IF;

  -- BRAT başarımları.
  IF v_winner = v_player_number AND v_own_guess_count = 1 THEN
    v_keys := array_append(v_keys, 'brat_one_guess');
  END IF;
  IF v_winner IS NOT NULL AND v_winner <> v_player_number AND v_own_minus_four THEN
    v_keys := array_append(v_keys, 'brat_hizli_kosan_atin');
  END IF;
  IF v_winner = v_player_number AND v_opponent_minus_four THEN
    v_keys := array_append(v_keys, 'brat_got_tutustu');
  END IF;

  -- Gizli 8041 başarımları.
  IF v_winner = v_player_number AND v_opponent_secret = '8041' THEN
    v_keys := array_append(v_keys, 'hidden_tarikat_cokuyor');
  END IF;
  IF v_winner = v_player_number AND v_own_secret = '8041' THEN
    v_keys := array_append(v_keys, 'hidden_kult_lideri');
  END IF;

  -- Beş galibiyetlik seri.
  IF coalesce(v_streak, 0) >= 5 THEN
    v_keys := array_append(v_keys, 'streak_5');
  END IF;

  FOREACH v_key IN ARRAY v_keys LOOP
    INSERT INTO public.player_achievements (profile_id, achievement_key, match_key)
    VALUES (p_profile_id, v_key, p_match_key)
    ON CONFLICT (profile_id, achievement_key) DO NOTHING;

    IF FOUND THEN
      v_new_keys := array_append(v_new_keys, v_key);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('unlocked', to_jsonb(v_new_keys));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_player_achievements(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_match_achievements(uuid, uuid, text, text) TO anon, authenticated;
