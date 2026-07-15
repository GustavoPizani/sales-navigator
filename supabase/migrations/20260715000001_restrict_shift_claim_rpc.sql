-- get_shift_config_by_token was left reachable by anon under the assumption
-- that the shift-claim link is a public/unauthenticated flow. It isn't: the
-- claim page lives under /_authenticated and already requires login before
-- it's ever reached, so anon access here is unnecessary surface area.
REVOKE ALL ON FUNCTION public.get_shift_config_by_token(text) FROM anon;
