// Guia "Primeiros passos com a extensão", no formato da guia de coleta do
// Hypnobox (src/lib/coleta/guia.ts). Cada passo se marca sozinho quando o
// sistema percebe que foi feito (ext_guia_progresso); "baixar" e "disparo" o
// próprio corretor marca.

export type PassoExtensaoId =
  | "baixar"
  | "instalar"
  | "whatsapp"
  | "login"
  | "chave"
  | "vincular"
  | "sugestao"
  | "transcricao"
  | "disparo";

export type PassoExtensao = {
  id: PassoExtensaoId;
  titulo: string;
  serve: string;
  instrucoes: string[];
  /** o corretor marca como feito (os outros o sistema marca sozinho) */
  manual?: boolean;
  /** link de apoio */
  link?: { texto: string; href: string; externo?: boolean };
};

export const ARQUIVO_EXTENSAO = "/extensao/gestao-whatsapp.zip";

export const PASSOS_EXTENSAO: PassoExtensao[] = [
  {
    id: "baixar",
    titulo: "Baixar a extensão",
    serve: "O arquivo da extensão, que você instala uma vez no Chrome do computador.",
    instrucoes: [
      "Clique em Baixar a extensão.",
      "Abra a pasta Downloads, clique com o botão direito no arquivo gestao-whatsapp.zip e escolha Extrair tudo. Guarde a pasta extraída num lugar fixo (por exemplo, Documentos): o Chrome usa essa pasta enquanto a extensão estiver instalada.",
    ],
    manual: true,
  },
  {
    id: "instalar",
    titulo: "Instalar no Chrome",
    serve: "Coloca a extensão no Chrome. É feito uma vez em cada computador.",
    instrucoes: [
      "No Chrome, digite chrome://extensions na barra de endereço e aperte Enter.",
      "Ligue o Modo do desenvolvedor, no canto de cima à direita.",
      "Clique em Carregar sem compactação e escolha a pasta que você extraiu.",
      "Clique no ícone de peça de quebra-cabeça ao lado da barra de endereço e fixe a extensão Gestão Comercial WhatsApp.",
      "O Chrome pode avisar que há extensões em modo do desenvolvedor: é normal, pode fechar o aviso.",
    ],
  },
  {
    id: "whatsapp",
    titulo: "Abrir o WhatsApp Web",
    serve: "A extensão funciona dentro do WhatsApp Web, com o seu WhatsApp de trabalho.",
    instrucoes: [
      "Abra web.whatsapp.com e conecte o seu WhatsApp, se ainda não estiver conectado.",
      "Aparece uma faixa do Gestão Comercial do lado direito. Ela recolhe e abre pela lingueta na borda.",
    ],
    link: { texto: "Abrir o WhatsApp Web", href: "https://web.whatsapp.com", externo: true },
  },
  {
    id: "login",
    titulo: "Entrar com a sua conta do sistema",
    serve: "A faixa usa o mesmo login do Gestão Comercial, para mostrar só os seus clientes.",
    instrucoes: ["Na faixa, entre com o seu e-mail e senha do Gestão Comercial."],
  },
  {
    id: "chave",
    titulo: "Cadastrar a sua chave de IA (Groq)",
    serve: "As sugestões de resposta e as transcrições de áudio usam uma chave gratuita do Groq, só sua.",
    instrucoes: ["Siga o passo a passo da página Minha chave de IA. Você faz isso uma vez; vale em qualquer computador."],
    link: { texto: "Abrir Minha chave de IA", href: "/settings/chave-ia" },
  },
  {
    id: "vincular",
    titulo: "Vincular o primeiro cliente",
    serve: "Liga a conversa ao cliente do Hypnobox. Só conversas vinculadas são lidas pelo sistema.",
    instrucoes: [
      "Abra a conversa de um cliente no WhatsApp Web.",
      "A faixa procura o cliente pelo telefone. Confirme o cliente certo, ou busque pelo nome.",
      "Conversa pessoal? Marque Não é cliente: ela não é lida.",
    ],
  },
  {
    id: "sugestao",
    titulo: "Usar uma sugestão de resposta",
    serve: "A IA lê o fim da conversa e propõe três respostas. Você escolhe, revisa e envia.",
    instrucoes: [
      "Numa conversa vinculada, clique em Sugerir resposta.",
      "Clique na sugestão que preferir: o texto vai para a caixa de mensagem do WhatsApp. Ajuste e envie.",
    ],
  },
  {
    id: "transcricao",
    titulo: "Transcrever um áudio",
    serve: "Transforma o áudio do cliente em texto, para você ler rápido e para a IA entender a conversa.",
    instrucoes: ["Numa conversa vinculada com áudio, clique em Transcrever ao lado do áudio, na faixa."],
  },
  {
    id: "disparo",
    titulo: "Aprender o disparo pelo WhatsApp Business",
    serve:
      "A extensão não faz disparo em massa: ela escolhe os clientes, marca a etiqueta e baixa o público em CSV; a transmissão é criada na Transmissão comercial do próprio WhatsApp Web e paga por crédito (comprado no celular).",
    instrucoes: [
      "No WhatsApp Web, na faixa do Gestão Comercial, abra a aba Disparo.",
      "Siga os 6 passos do guia (Próximo) e clique em Concluí no fim: este passo se marca sozinho.",
    ],
  },
];
