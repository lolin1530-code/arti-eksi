-- ARTI EKSİ: İki oyuncunun maç sonucunu tek sunucu işlemiyle kaydet.
-- Supabase SQL Editor'de bir kez çalıştır.
-- Ayrıca aynı odadaki eski tek taraflı kayıtların eksik rakip tarafını tamamlar.

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
AS $$
DECLARE
  r public.game_rooms%ROWTYPE;
  v_player integer;
  v_expected_profile_id uuid;
  v_profile_id uuid;
  v_player_no integer;
  v_won boolean;
  v_inserted_profile_id uuid;
  v_winner_text text;
  v_old_match_key text;
  v_winner integer;
  v_inserted integer := 0;
  v_backfilled integer := 0;
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
  v_expected_profile_id := CASE WHEN v_player = 1 THEN r.player1_profile_id ELSE r.player2_profile_id END;

  IF v_expected_profile_id IS DISTINCT FROM p_profile_id THEN
    RAISE EXCEPTION 'Profil bu oyuncu oturumuna bağlı değil.';
  END IF;

  IF p_match_key NOT LIKE r.room_code || '|%' THEN
    RAISE EXCEPTION 'Maç anahtarı bu odayla eşleşmiyor.';
  END IF;

  -- Önce her iki oyuncu için de kayıt aç. ON CONFLICT sayesinde iki
  -- tarayıcı aynı anda çağırsa bile istatistikler yalnızca bir kez artar.
  FOR v_profile_id, v_player_no IN
    SELECT r.player1_profile_id, 1
    UNION ALL
    SELECT r.player2_profile_id, 2
  LOOP
    IF v_profile_id IS NOT NULL THEN
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
        UPDATE public.player_profiles
        SET
          wins = wins + CASE WHEN v_won IS TRUE THEN 1 ELSE 0 END,
          losses = losses + CASE WHEN v_won IS FALSE THEN 1 ELSE 0 END,
          streak = CASE
            WHEN v_won IS TRUE THEN streak + 1
            WHEN v_won IS FALSE THEN 0
            ELSE streak
          END
        WHERE id = v_profile_id;
      END IF;
    END IF;
  END LOOP;

  -- Aynı odada daha önce yalnızca bir tarafta kalmış maçları tamamla.
  -- Eski match_key biçimi: oda_kodu|kazanan_oyuncu_numarası|tahmin_geçmişi
  IF r.player1_profile_id IS NOT NULL AND r.player2_profile_id IS NOT NULL THEN
    FOR v_old_match_key, v_winner_text IN
      SELECT m.match_key, split_part(m.match_key, '|', 2)
      FROM public.player_match_results m
      WHERE m.profile_id = p_profile_id
        AND m.match_key LIKE r.room_code || '|%'
    LOOP
      IF v_winner_text = 'null' THEN
        v_winner := NULL;
      ELSIF v_winner_text ~ '^[12]$' THEN
        v_winner := v_winner_text::integer;
      ELSE
        CONTINUE;
      END IF;

      v_profile_id := CASE WHEN v_player = 1 THEN r.player2_profile_id ELSE r.player1_profile_id END;
      v_player_no := CASE WHEN v_player = 1 THEN 2 ELSE 1 END;
      v_won := CASE WHEN v_winner IS NULL THEN NULL ELSE v_winner = v_player_no END;
      v_inserted_profile_id := NULL;

      INSERT INTO public.player_match_results (profile_id, match_key, won, is_draw)
      VALUES (v_profile_id, v_old_match_key, COALESCE(v_won, false), v_won IS NULL)
      ON CONFLICT (profile_id, match_key) DO NOTHING
      RETURNING profile_id INTO v_inserted_profile_id;

      IF v_inserted_profile_id IS NOT NULL THEN
        v_backfilled := v_backfilled + 1;
        UPDATE public.player_profiles
        SET
          wins = wins + CASE WHEN v_won IS TRUE THEN 1 ELSE 0 END,
          losses = losses + CASE WHEN v_won IS FALSE THEN 1 ELSE 0 END,
          streak = CASE
            WHEN v_won IS TRUE THEN streak + 1
            WHEN v_won IS FALSE THEN 0
            ELSE streak
          END
        WHERE id = v_profile_id;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'inserted', v_inserted,
    'backfilled', v_backfilled
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_room_profile_results(uuid, uuid, text, text) TO anon, authenticated;
