-- O admin e o gerente da equipe podem finalizar o cadastro de um corretor
-- pré-cadastrado (criam a conta com senha temporária). Antes disso, podem
-- ajustar o e-mail corporativo do pré-cadastro.
CREATE OR REPLACE FUNCTION public.crm_pending_set_email(p_id UUID, p_email TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _email TEXT := public.crm_corporate_email(p_email);
  _manager UUID;
BEGIN
  SELECT manager_id INTO _manager FROM public.pending_brokers WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pré-cadastro não encontrado.'; END IF;
  IF NOT (public.is_admin(auth.uid()) OR (public.is_manager(auth.uid()) AND _manager = auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pending_brokers WHERE lower(email) = _email AND id <> p_id)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = _email) THEN
    RAISE EXCEPTION 'O e-mail % já está cadastrado.', _email;
  END IF;
  UPDATE public.pending_brokers SET email = _email WHERE id = p_id;
  RETURN _email;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_pending_set_email(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_pending_set_email(UUID, TEXT) TO authenticated;
