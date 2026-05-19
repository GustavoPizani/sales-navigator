-- Seed the initial admin account.
-- Idempotent: skips if pizanicorretor@gmail.com already exists.
-- The handle_new_user() trigger fires on auth.users INSERT and creates
-- the matching profile row; since profiles is empty at this point it
-- assigns role = 'admin' automatically.

DO $$
DECLARE
  v_uid UUID;
BEGIN
  -- Bail out early if the account is already there
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = 'pizanicorretor@gmail.com') THEN
    RAISE NOTICE 'seed_admin: user already exists, skipping.';
    RETURN;
  END IF;

  v_uid := gen_random_uuid();

  -- 1) Auth user -------------------------------------------------------
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_uid,
    'authenticated',
    'authenticated',
    'pizanicorretor@gmail.com',
    crypt('123456', gen_salt('bf')),
    now(),           -- email_confirmed_at — marks email as verified
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pizani Setin"}'::jsonb,
    false,
    '', '', '', ''   -- empty tokens
  );

  -- 2) Identity row (needed so signInWithPassword resolves the user) ---
  -- Try the current Supabase schema (provider_id TEXT); fall back to
  -- the older schema (id UUID) so this migration works on all versions.
  BEGIN
    INSERT INTO auth.identities (
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      'pizanicorretor@gmail.com',   -- provider_id = email for email provider
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'pizanicorretor@gmail.com'),
      'email',
      now(), now(), now()
    );
  EXCEPTION WHEN undefined_column OR invalid_column_reference THEN
    -- Older Supabase versions use a UUID primary key called "id"
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      v_uid,
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'pizanicorretor@gmail.com'),
      'email',
      now(), now(), now()
    );
  END;

  -- 3) Profile is created automatically by the handle_new_user() trigger.
  --    Because profiles is empty at this point, role = 'admin' is assigned.
  --    We just need to make sure full_name is correct.
  --    The trigger already reads raw_user_meta_data->>'full_name', so
  --    "Pizani Setin" will be set. Nothing extra needed here.

  RAISE NOTICE 'seed_admin: admin account created (uid = %)', v_uid;
END;
$$;
