-- Harden legacy SSH direct RPCs.
--
-- Supabase Security Advisor reported these SECURITY DEFINER functions as
-- anonymously executable. osa_ssh_edge_claim can return the decrypted SSH
-- private key and an execution token after a valid dispatch token, so the
-- database API surface must be service-role only.
--
-- The current GitHub Raw SSH broker does not call these legacy RPCs; it uses
-- GitHub OIDC plus the service-role client and the newer raw SSH job path.

revoke execute on function public.osa_ssh_edge_claim(uuid, text) from public;
revoke execute on function public.osa_ssh_edge_claim(uuid, text) from anon;
revoke execute on function public.osa_ssh_edge_claim(uuid, text) from authenticated;
grant execute on function public.osa_ssh_edge_claim(uuid, text) to service_role;

revoke execute on function public.osa_ssh_edge_finish(uuid, text, text, integer, text, text) from public;
revoke execute on function public.osa_ssh_edge_finish(uuid, text, text, integer, text, text) from anon;
revoke execute on function public.osa_ssh_edge_finish(uuid, text, text, integer, text, text) from authenticated;
grant execute on function public.osa_ssh_edge_finish(uuid, text, text, integer, text, text) to service_role;
