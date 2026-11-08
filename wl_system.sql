-- ARTI EKSİ: Baştan kurulmuş, oda içindeki her yeni turu ayrı sayan W/L sistemi.
-- Supabase SQL Editor'de bu dosyanın TAMAMINI bir kez çalıştır.
-- Aynı odada tekrar oynandığında match_id otomatik yenilenir.
-- Beraberlik yenilmezlik serisini bozmaz ve artırmaz; mağlubiyet sıfırlar.

BEGIN;

-- 1) İstatistik sütunları. Mevcut hesaplar ve kullanıcı adları korunur.
ALTER TABLE public.player_profiles
  ADD COLUMN IF NOT EXISTS draws integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_matches integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_unbeaten_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_unbeaten_streak integer NOT NULL DEFAULT 0;

-- 2) Her oda turuna benzersiz kimlik.
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS match_id uuid DEFAULT gen_random_uuid();

UPDATE public.game_rooms
SET match_id = gen_random_uuid()
WHERE match_id IS NULL;

ALTER TABLE public.game_rooms
  ALTER COLUMN match_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN match_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS game_rooms_match_id_idx
  ON public.game_rooms(match_id);

-- Aynı odada finished -> waiting geçişi yeni bir maç başlatır.
CREATE OR REPLACE FUNCTION public.assign_new_match_id_on_restart()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.game_status = 'finished' AND NEW.game_status = 'waiting' THEN
    NEW.match_id := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assign_new_match_id_on_restart ON public.game_rooms;

CREATE TRIGGER trg_assign_new_match_id_on_restart
BEFORE UPDATE OF game_status ON public.game_rooms
FOR EACH ROW
EXECUTE FUNCTION public.assign_new_match_id_on_restart();

-- 3) Oyun durumu: maç kimliği ve iki profilin istatistikleri istemciye döner.
CREATE OR REPLACE FUNCTION public.get_game_state(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    r public.game_rooms%ROWTYPE;
    v_player integer;
    v_history jsonb;
    v_player1_profile jsonb;
    v_player2_profile jsonb;
BEGIN
    SELECT * INTO r
    FROM public.game_rooms
    WHERE player1_id = p_token OR player2_id = p_token;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Oyuncu bulunamadı.';
    END IF;

    v_player := CASE WHEN r.player1_id = p_token THEN 1 ELSE 2 END;

    SELECT COALESCE(
        jsonb_agg(jsonb_build_object(
            'player', player_number,
            'guess', guess,
            'plus', plus_count,
            'minus', minus_count
        ) ORDER BY created_at, id),
        '[]'::jsonb
    )
    INTO v_history
    FROM public.game_guesses
    WHERE room_id = r.id;

    SELECT jsonb_build_object(
        'id', id,
        'username', username,
        'wins', COALESCE(wins, 0),
        'losses', COALESCE(losses, 0),
        'draws', COALESCE(draws, 0),
        'total_matches', COALESCE(total_matches, 0),
        'streak', COALESCE(streak, 0),
        'current_unbeaten_streak', COALESCE(current_unbeaten_streak, 0),
        'best_unbeaten_streak', COALESCE(best_unbeaten_streak, 0),
        'win_rate', CASE WHEN COALESCE(total_matches, 0) = 0 THEN 0
                         ELSE ROUND(wins::numeric * 100 / total_matches, 1) END
    )
    INTO v_player1_profile
    FROM public.player_profiles
    WHERE id = r.player1_profile_id;

    SELECT jsonb_build_object(
        'id', id,
        'username', username,
        'wins', COALESCE(wins, 0),
        'losses', COALESCE(losses, 0),
        'draws', COALESCE(draws, 0),
        'total_matches', COALESCE(total_matches, 0),
        'streak', COALESCE(streak, 0),
        'current_unbeaten_streak', COALESCE(current_unbeaten_streak, 0),
        'best_unbeaten_streak', COALESCE(best_unbeaten_streak, 0),
        'win_rate', CASE WHEN COALESCE(total_matches, 0) = 0 THEN 0
                         ELSE ROUND(wins::numeric * 100 / total_matches, 1) END
    )
    INTO v_player2_profile
    FROM public.player_profiles
    WHERE id = r.player2_profile_id;

    RETURN jsonb_build_object(
        'room_code', r.room_code,
        'match_id', r.match_id,
        'player', v_player,
        'status', r.game_status,
        'turn', r.current_turn,
        'winner', r.winner,
        'opponent_joined', CASE
            WHEN v_player = 1 THEN r.player2_id IS NOT NULL
            ELSE r.player1_id IS NOT NULL
        END,
        'opponent_locked', CASE
            WHEN v_player = 1 THEN r.player2_secret IS NOT NULL
            ELSE r.player1_secret IS NOT NULL
        END,
        'history', v_history,
        'player1_profile', v_player1_profile,
        'player2_profile', v_player2_profile,
        'player1_username', v_player1_profile->>'username',
        'player2_username', v_player2_profile->>'username',
        'opponent_username', CASE
            WHEN v_player = 1 THEN v_player2_profile->>'username'
            ELSE v_player1_profile->>'username'
        END
    );
END;
$function$;

-- 3.5) Eski W/L temizliği bu tabloyu kaldırmış olabilir; yeni sistem için yeniden kur.
CREATE TABLE IF NOT EXISTS public.player_match_results (
  id bigserial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  match_key text NOT NULL,
  won boolean NOT NULL DEFAULT false,
  is_draw boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_match_results_profile_match_key UNIQUE (profile_id, match_key)
);

CREATE INDEX IF NOT EXISTS player_match_results_profile_created_idx
  ON public.player_match_results(profile_id, created_at, match_key);

-- 4) Maç sonucunu iki oyuncu için tek transaction'da ve yalnızca bir kez kaydet.
CREATE OR REPLACE FUNCTION public.record_room_profile_results(
  p_token uuid,
  p_profile_id uuid,
  p_profile_token text,
  p_match_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  r public.game_rooms%ROWTYPE;
  v_player integer;
  v_expected_profile_id uuid;
  v_profile_id uuid;
  v_player_no integer;
  v_won boolean;
  v_inserted_profile_id uuid;
  v_inserted integer := 0;
  v_wins integer;
  v_losses integer;
  v_draws integer;
  v_total integer;
  v_unbeaten_values integer[];
  v_win_values integer[];
  v_current_unbeaten integer := 0;
  v_best_unbeaten integer := 0;
  v_current_win_streak integer := 0;
  v_running integer := 0;
  v_i integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.player_profile_secrets s
    WHERE s.profile_id = p_profile_id
      AND s.token_hash = encode(digest(p_profile_token, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'Profil doğrulanamadı.';
  END IF;

  SELECT *
  INTO r
  FROM public.game_rooms
  WHERE (player1_id = p_token OR player2_id = p_token)
    AND game_status = 'finished'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tamamlanmış maç bulunamadı.';
  END IF;

  v_player := CASE WHEN r.player1_id = p_token THEN 1 ELSE 2 END;
  v_expected_profile_id := CASE
    WHEN v_player = 1 THEN r.player1_profile_id
    ELSE r.player2_profile_id
  END;

  IF v_expected_profile_id IS DISTINCT FROM p_profile_id THEN
    RAISE EXCEPTION 'Profil bu oyuncu oturumuna bağlı değil.';
  END IF;

  IF p_match_key NOT LIKE r.room_code || '|' || r.match_id::text || '|%' THEN
    RAISE EXCEPTION 'Maç anahtarı bu tura ait değil.';
  END IF;

  -- Her iki profil için de aynı maç kimliğiyle kayıt açılır.
  -- Unique (profile_id, match_key) ve ON CONFLICT çift kayıt/çift sayımı engeller.
  FOR v_profile_id, v_player_no IN
    SELECT r.player1_profile_id, 1
    UNION ALL
    SELECT r.player2_profile_id, 2
  LOOP
    IF v_profile_id IS NULL THEN
      CONTINUE;
    END IF;

    v_won := CASE
      WHEN r.winner IS NULL THEN NULL
      ELSE r.winner = v_player_no
    END;

    v_inserted_profile_id := NULL;

    INSERT INTO public.player_match_results (profile_id, match_key, won, is_draw)
    VALUES (v_profile_id, p_match_key, COALESCE(v_won, false), v_won IS NULL)
    ON CONFLICT (profile_id, match_key) DO NOTHING
    RETURNING profile_id INTO v_inserted_profile_id;

    IF v_inserted_profile_id IS NOT NULL THEN
      v_inserted := v_inserted + 1;
    END IF;

    -- İstatistikleri kayıt tablosundan yeniden hesapla; tekrar çağrılsa da artış olmaz.
    SELECT
      COUNT(*) FILTER (WHERE won IS TRUE)::integer,
      COUNT(*) FILTER (WHERE won IS FALSE AND is_draw IS NOT TRUE)::integer,
      COUNT(*) FILTER (WHERE is_draw IS TRUE)::integer,
      COUNT(*)::integer,
      ARRAY_AGG(
        CASE WHEN won IS TRUE THEN 1
             WHEN is_draw IS TRUE THEN 0
             ELSE -1 END
        ORDER BY created_at, match_key
      ),
      ARRAY_AGG(
        CASE WHEN won IS TRUE THEN 1 ELSE 0 END
        ORDER BY created_at, match_key
      )
    INTO v_wins, v_losses, v_draws, v_total, v_unbeaten_values, v_win_values
    FROM public.player_match_results
    WHERE profile_id = v_profile_id;

    -- Yenilmezlik: galibiyet +1, beraberlik bekletir, mağlubiyet sıfırlar.
    v_current_unbeaten := 0;
    v_best_unbeaten := 0;
    v_running := 0;

    IF v_unbeaten_values IS NOT NULL THEN
      FOR v_i IN 1..array_length(v_unbeaten_values, 1) LOOP
        IF v_unbeaten_values[v_i] = -1 THEN
          v_running := 0;
        ELSIF v_unbeaten_values[v_i] = 1 THEN
          v_running := v_running + 1;
          v_best_unbeaten := GREATEST(v_best_unbeaten, v_running);
        END IF;
      END LOOP;

      v_running := 0;
      FOR v_i IN REVERSE array_length(v_unbeaten_values, 1)..1 LOOP
        IF v_unbeaten_values[v_i] = -1 THEN
          EXIT;
        ELSIF v_unbeaten_values[v_i] = 1 THEN
          v_running := v_running + 1;
        END IF;
      END LOOP;
      v_current_unbeaten := v_running;
    END IF;

    -- Eski streak alanı, art arda kazanılan maçları temsil etmeye devam eder.
    v_current_win_streak := 0;
    IF v_win_values IS NOT NULL THEN
      FOR v_i IN REVERSE array_length(v_win_values, 1)..1 LOOP
        IF v_win_values[v_i] = 1 THEN
          v_current_win_streak := v_current_win_streak + 1;
        ELSE
          EXIT;
        END IF;
      END LOOP;
    END IF;

    UPDATE public.player_profiles
    SET wins = COALESCE(v_wins, 0),
        losses = COALESCE(v_losses, 0),
        draws = COALESCE(v_draws, 0),
        total_matches = COALESCE(v_total, 0),
        streak = v_current_win_streak,
        current_unbeaten_streak = v_current_unbeaten,
        best_unbeaten_streak = v_best_unbeaten
    WHERE id = v_profile_id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'match_id', r.match_id,
    'inserted', v_inserted
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_room_profile_results(uuid, uuid, text, text) TO anon, authenticated;

-- 5) Kendi profilin ve arkadaşların için toplu, herkese açık maç istatistikleri.
CREATE OR REPLACE FUNCTION public.get_public_wl_stats(p_profile_ids uuid[])
RETURNS TABLE (
  profile_id uuid,
  username text,
  wins integer,
  losses integer,
  draws integer,
  total_matches integer,
  current_unbeaten_streak integer,
  best_unbeaten_streak integer,
  win_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    p.id,
    p.username,
    COALESCE(p.wins, 0)::integer,
    COALESCE(p.losses, 0)::integer,
    COALESCE(p.draws, 0)::integer,
    COALESCE(p.total_matches, 0)::integer,
    COALESCE(p.current_unbeaten_streak, 0)::integer,
    COALESCE(p.best_unbeaten_streak, 0)::integer,
    CASE WHEN COALESCE(p.total_matches, 0) = 0 THEN 0::numeric
         ELSE ROUND(p.wins::numeric * 100 / p.total_matches, 1) END
  FROM public.player_profiles p
  WHERE p.id = ANY(COALESCE(p_profile_ids, ARRAY[]::uuid[]));
$function$;

GRANT EXECUTE ON FUNCTION public.get_public_wl_stats(uuid[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
