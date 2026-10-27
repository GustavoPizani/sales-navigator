/** Linha do tempo do cliente no Hypnobox (mesmo link do painel e do 1:1). */
export const linkHypnobox = (id: string) =>
  `https://paesegregori.hypnobox.com.br/?controle=Cliente&acao=timeline&id_cliente=${encodeURIComponent(id)}&janelaSimples=S`;
