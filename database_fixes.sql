-- ARTI EKSİ: rakip adı ve arkadaşlık isteği düzeltmeleri
-- Supabase SQL Editor'de bir kez çalıştır.

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
        'id', id, 'username', username,
        'wins', wins, 'losses', losses, 'streak', streak
    )
    INTO v_player1_profile
    FROM public.player_profiles
    WHERE id = r.player1_profile_id;

    SELECT jsonb_build_object(
        'id', id, 'username', username,
        'wins', wins, 'losses', losses, 'streak', streak
    )
    INTO v_player2_profile
    FROM public.player_profiles
    WHERE id = r.player2_profile_id;

    RETURN jsonb_build_object(
        'room_code', r.room_code,
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

CREATE OR REPLACE FUNCTION public.respond_friend_request(
    p_id uuid,
    p_token text,
    p_request_id uuid,
    p_accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hash text;
    v_status text;
BEGIN
    SELECT token_hash INTO v_hash
    FROM public.player_profile_secrets
    WHERE profile_id = p_id;

    IF v_hash IS NULL OR v_hash <> encode(digest(p_token, 'sha256'), 'hex') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Profil doğrulanamadı.');
    END IF;

    UPDATE public.friendships
    SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END
    WHERE id = p_request_id
      AND receiver_id = p_id
      AND status = 'pending';

    IF FOUND THEN
        RETURN jsonb_build_object('success', true);
    END IF;

    -- Karşılıklı istek gönderimi satırı önceden kabul etmiş olabilir.
    SELECT status INTO v_status
    FROM public.friendships
    WHERE id = p_request_id
      AND receiver_id = p_id;

    IF p_accept AND v_status = 'accepted' THEN
        RETURN jsonb_build_object('success', true, 'already_accepted', true);
    END IF;

    RETURN jsonb_build_object('success', false, 'message', 'İstek bulunamadı veya artık yanıtlanamıyor.');
END;
$function$;
