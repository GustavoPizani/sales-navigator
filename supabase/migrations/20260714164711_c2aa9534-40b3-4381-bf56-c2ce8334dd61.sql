CREATE OR REPLACE FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_privileged boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_caller
      AND role IN ('admin', 'master')
      AND is_active = true
  ) INTO v_is_privileged;

  IF NOT v_is_privileged THEN
    RAISE EXCEPTION 'Sem permissão para redefinir senha';
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'Senha inválida';
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"force_password_change": true}'::jsonb,
    updated_at = now()
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reset_password(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_password(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(uuid, text) TO authenticated;