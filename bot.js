require("dotenv").config();
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const express = require("express");

let bot; // Variável global para o bot

// ==================== INICIALIZAR EXPRESS PARA HEALTH CHECK ====================
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Rota de Health Check
app.get("/health", (req, res) => {
  res.status(200).send("OK - Bot rodando!");
});

// Rota raiz
app.get("/", (req, res) => {
  res.status(200).json({ status: "Bot Telegram rodando com sucesso!", timestamp: new Date().toISOString() });
});

// Iniciar servidor Express (não bloqueia o resto do código)
app.listen(PORT, () => {
  console.log(`\n🌐 Servidor HTTP rodando na porta ${PORT}`);
  console.log(`   📍 Health Check: http://localhost:${PORT}/health`);
  console.log(`   📍 Status: http://localhost:${PORT}/\n`);
});

// ==================== DEBUG INICIAL ====================
console.log("\n");
console.log("╔════════════════════════════════════════╗");
console.log("║   🤖 INICIANDO BOT TELEGRAM + FIREBASE   ║");
console.log("╚════════════════════════════════════════╝\n");

console.log("📋 DEBUG - Variáveis de Ambiente:");
console.log("   TELEGRAM_TOKEN:", process.env.TELEGRAM_TOKEN ? "✅ Configurado" : "❌ Não configurado");
console.log("   FIREBASE_SERVICE_ACCOUNT:", process.env.FIREBASE_SERVICE_ACCOUNT ? "✅ Configurado" : "❌ Não configurado");
console.log("   NODE_ENV:", process.env.NODE_ENV || "desenvolvimento");
console.log("   PORT:", PORT);
console.log("");

// ==================== INICIALIZAR FIREBASE ====================
async function inicializarFirebase() {
  console.log("🔥 Inicializando Firebase...");

  try {
    let serviceAccount;
    let firebaseLoadMethod = "NENHUM";

    // Método 1: Tentar variável de ambiente como JSON string
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log("   📍 Tentando carregar FIREBASE_SERVICE_ACCOUNT como JSON string...");
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        firebaseLoadMethod = "JSON String (Variável de Ambiente)";
        console.log("   ✅ Service Account carregado da variável de ambiente (JSON String)");
      } catch (parseError) {
        console.log("   ⚠️  Não é JSON válido, tentando como caminho...");

        const filePath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log("   📍 Verificando arquivo:", filePath);

        if (fs.existsSync(filePath)) {
          serviceAccount = require(filePath);
          firebaseLoadMethod = `Arquivo: ${filePath}`;
          console.log("   ✅ Service Account carregado do arquivo:", filePath);
        } else {
          throw new Error(`Arquivo não encontrado: ${filePath}`);
        }
      }
    }
    // Método 2: Fallback para arquivo local padrão
    else if (fs.existsSync("./serviceAccountKey.json")) {
      console.log("   📍 Variável de ambiente não definida, usando arquivo local padrão...");
      serviceAccount = require("./serviceAccountKey.json");
      firebaseLoadMethod = "Arquivo Local: ./serviceAccountKey.json";
      console.log("   ✅ Service Account carregado de ./serviceAccountKey.json");
    }
    // Sem opção disponível
    else {
      throw new Error(
        "❌ Nenhuma credencial do Firebase encontrada!\n" +
          "   Configure uma destas opções:\n" +
          "   1. Defina FIREBASE_SERVICE_ACCOUNT com o JSON completo\n" +
          "   2. Defina FIREBASE_SERVICE_ACCOUNT com o caminho do arquivo\n" +
          "   3. Coloque o arquivo serviceAccountKey.json na raiz do projeto"
      );
    }

    // Validar estrutura do serviceAccount
    if (!serviceAccount.project_id || !serviceAccount.private_key) {
      throw new Error("❌ Service Account inválido: faltam campos obrigatórios (project_id, private_key)");
    }

    console.log(`   📊 Project ID: ${serviceAccount.project_id}`);
    console.log(`   📊 Client Email: ${serviceAccount.client_email}`);

    // Inicializar Firebase
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://nzilaexpo-default-rtdb.firebaseio.com"
      });
    } else {
      console.log("   ⚠️  Firebase já estava inicializado");
    }

    const db = admin.database();

    // ==================== VERIFICAR CONEXÃO FIREBASE ====================
    db.ref('.info/connected').on('value', (snap) => {
      if (snap.val() === true) {
        console.log('✅ [' + new Date().toISOString() + '] Conectado ao Firebase!');
      } else {
        console.log('⚠️ [' + new Date().toISOString() + '] Desconectado do Firebase - Tentando reconectar...');
      }
    });

    console.log(`✅ Firebase inicializado com sucesso!`);
    console.log(`   Método: ${firebaseLoadMethod}\n`);

    global.db = db;
    return true;
  } catch (error) {
    console.error("❌ Erro ao inicializar Firebase:", error.message);
    console.error("\n📌 Dicas de resolução:");
    console.error("   - Verifique se a variável FIREBASE_SERVICE_ACCOUNT está configurada");
    console.error("   - Certifique-se de que o JSON é válido");
    process.exit(1);
  }
}

// ==================== FUNÇÃO COM RETRY ====================
async function executarComRetry(funcao, tentativas = 3, delay = 1000) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await funcao();
    } catch (error) {
      console.error(`Tentativa ${i + 1}/${tentativas} falhou:`, error.message);
      if (i < tentativas - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      } else {
        throw error;
      }
    }
  }
}

// ==================== FUNÇÕES AUXILIARES ====================

// Função auxiliar para verificar se usuário bloqueou o bot (ERRO 403)
function verificarBloqueio(error) {
  return error.response && error.response.statusCode === 403 && error.response.body && error.response.body.description.includes("blocked");
}

// Função para enviar mensagem com tratamento de bloqueio
function enviarMensagemComBloqueio(chatId, mensagem, opcoes = {}) {
  return bot.sendMessage(chatId, mensagem, opcoes).catch((err) => {
    // ✅ Tratamento de erro 403 - usuário bloqueou o bot
    if (verificarBloqueio(err)) {
      console.log(`🚫 Usuário ${chatId} bloqueou o bot (erro 403)`);
    } else {
      throw err;
    }
  });
}

// Verificar se usuário é novo
async function isNovoUsuario(userId) {
  return executarComRetry(async () => {
    const snapshot = await global.db.ref(`usuarios/${userId}`).once('value', null, { timeout: 30000 });
    return !snapshot.exists();
  });
}

// Salvar convite
async function salvarConvite(donoId, convidadoId) {
  return executarComRetry(async () => {
    const ref = global.db.ref(`convites/${donoId}`);
    const snapshot = await ref.once('value', null, { timeout: 30000 });
    const convites = snapshot.val() || [];

    const jaExiste = convites.some(c => c.convidado === convidadoId);
    if (jaExiste) {
      await enviarMensagemComBloqueio(donoId, "⚠️ Esse usuário já foi convidado anteriormente. Convites duplicados não são contabilizados.");
      return;
    }

    convites.push({ convidado: convidadoId, data: new Date().toISOString() });
    await ref.set(convites);

    // Atualiza saldo do dono (0.5 USD ≈ 500 KZ por indicação)
    const saldoRef = global.db.ref(`saldos/${donoId}`);
    const saldoSnap = await saldoRef.once('value', null, { timeout: 30000 });
    const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

    saldo.usd += 0.5;
    saldo.kz += 500;
    await saldoRef.set(saldo);

    let mensagem = `🎉 Você convidou ${convites.length} pessoas únicas! Parabéns!\n💰 Saldo atualizado: ${saldo.usd.toFixed(2)} USD | ${saldo.kz} KZ`;

    if (convites.length >= 15) {
      mensagem += "\n🏆 WIN! Você atingiu 15 convites e ganhou bônus especial!";
    }

    await enviarMensagemComBloqueio(donoId, mensagem);
  });
}

// Menu Principal
async function mostrarMenu(chatId) {
  try {
    await enviarMensagemComBloqueio(
      chatId,
      `🚀 BELIEVE MINER – A Nova Era da Mineração Digital 🌍\n💎 Ganhe lucros internacionais agora mesmo!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔥 Abrir Minerador Premium 🔥", web_app: { url: "https://believe-miner.surge.sh" } }],
            [{ text: "📋 Copiar meu link de convite", callback_data: "meu_link" }],
            [{ text: "👥 Ver meus convidados", callback_data: "meus_convidados" }],
            [{ text: "💰 Ver meu saldo", callback_data: "meu_saldo" }],
            [{ text: "🏦 Saque / Retirada", callback_data: "retirar_saldo" }],
            [{ text: "👨‍💼 Suporte – Fale com o gerente", url: "https://t.me/Suporte20260" }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Erro ao mostrar menu:', error);
  }
}

// Mensagem de Boas-vindas
async function enviarMensagemBoasVindas(chatId) {
  try {
    await bot.sendPhoto(
      chatId,
      "https://cdn.jornaldebrasilia.com.br/wp-content/uploads/2024/04/30134427/WhatsApp-Image-2024-04-30-at-12.45.15.jpeg",
      {
        caption: `📌 Convide e ganhe $50!  
💰 Deposite apenas 9.000 KZ (≈ $9) e receba diariamente 300 KZ (≈ $0.30) até 1 ano.

🚀 BELIEVE MINER – A Nova Era da Mineração Digital 🌍  
💎 Ganhe lucros internacionais agora mesmo!

A BELIEVE MINER chegou para revolucionar o mercado, pagando em USDT (Tether) e Kwanza (KZ) diretamente para você.

✨ Por que escolher a BELIEVE MINER?
- Pagamentos rápidos e seguros em USDT e KZ
- Plataforma moderna e confiável
- Lucros internacionais acessíveis para todos
- Sistema de referência que multiplica seus ganhos

🔑 Acesso exclusivo:`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔥 Abrir Minerador Premium 🔥", web_app: { url: "https://believe-miner.surge.sh" } }]
          ]
        }
      }
    ).catch((err) => {
      if (verificarBloqueio(err)) {
        console.log(`🚫 Usuário ${chatId} bloqueou o bot`);
      } else {
        throw err;
      }
    });
  } catch (error) {
    console.error('Erro ao enviar boas-vindas:', error);
  }
}

// ==================== INICIALIZAR BOT TELEGRAM ====================
function inicializarBotTelegram() {
  console.log("🤖 Inicializando Bot Telegram...");

  try {
    if (!process.env.TELEGRAM_TOKEN) {
      throw new Error("TELEGRAM_TOKEN não configurado nas variáveis de ambiente");
    }

    console.log("   📍 Token encontrado");
    console.log("   📍 Criando instância do bot...");

    // ✅ Bot em polling mode
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

    console.log("✅ Bot Telegram inicializado com sucesso!");
    console.log("   📌 Bot rodando em polling mode...\n");

    // ==================== EVENTOS DO BOT ====================
    bot.on("polling_error", (error) => {
      console.error("❌ Erro de polling:", error.code);
    });

    bot.on("polling_start", () => {
      console.log("✅ Bot começou a fazer polling...");
    });

    // ==================== COMANDO /START ====================
    bot.onText(/\/start(.*)/, async (msg, match) => {
      try {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const payload = match[1].trim();

        console.log(`📥 Novo acesso: ${msg.from.first_name} (ID: ${userId})`);

        // Verifica se é novo usuário
        const novoUsuario = await isNovoUsuario(userId);

        // Registra/atualiza usuário no Firebase
        await executarComRetry(async () => {
          await global.db.ref(`usuarios/${userId}`).set({
            nome: msg.from.first_name,
            data: new Date().toISOString()
          });
        });

        // Se é novo usuário, envia mensagem de boas-vindas única
        if (novoUsuario) {
          await enviarMensagemBoasVindas(chatId);

          // Aguarda 3 segundos antes de mostrar o menu
          setTimeout(async () => {
            await mostrarMenu(chatId);
          }, 3000);
        } else {
          // Se já é usuário existente, mostra direto o menu
          await mostrarMenu(chatId);
        }

        // Processa convite se houver payload
        if (payload) {
          await salvarConvite(payload, userId);
        }
      } catch (error) {
        console.error('❌ Erro no comando /start:', error);
        try {
          await bot.sendMessage(msg.chat.id, "❌ Ocorreu um erro. Tente novamente em alguns segundos.");
        } catch (e) {
          console.error('Erro ao responder no /start:', e);
        }
      }
    });

    // ==================== CALLBACKS DOS BOTÕES ====================
    bot.on("callback_query", async (query) => {
      try {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const data = query.data;

        console.log(`📌 Callback recebido: ${data} do usuário ${userId}`);

        if (data === "meu_link") {
          await enviarMensagemComBloqueio(chatId, `📋 Seu link de convite: https://t.me/Believeminerbot?start=${userId}`);
        }

        if (data === "meus_convidados") {
          await executarComRetry(async () => {
            const snapshot = await global.db.ref(`convites/${userId}`).once("value", null, { timeout: 30000 });
            const convites = snapshot.val() || [];
            await enviarMensagemComBloqueio(chatId, `👥 Você já convidou ${convites.length} pessoas únicas.`);
          });
        }

        if (data === "meu_saldo") {
          await executarComRetry(async () => {
            const saldoSnap = await global.db.ref(`saldos/${userId}`).once("value", null, { timeout: 30000 });
            const saldo = saldoSnap.val() || { usd: 0, kz: 0 };
            await enviarMensagemComBloqueio(chatId, `💰 Seu saldo: ${saldo.usd.toFixed(2)} USD | ${saldo.kz} KZ`);
          });
        }

        if (data === "retirar_saldo") {
          await executarComRetry(async () => {
            const saldoSnap = await global.db.ref(`saldos/${userId}`).once("value", null, { timeout: 30000 });
            const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

            if (saldo.usd <= 0 && saldo.kz <= 0) {
              await enviarMensagemComBloqueio(chatId, "⚠️ Você não possui saldo disponível para saque.");
            } else {
              await enviarMensagemComBloqueio(chatId, "🏦 Para retirar seu saldo, envie:\n\n📱 Seu número de celular internacional associado ao banco\nou\n💳 Endereço USDT (TRON20 Tether)\n\nAssim que enviar, o saque será processado com sucesso.");
            }
          });
        }

        await bot.answerCallbackQuery(query.id);
      } catch (error) {
        console.error("❌ Erro no callback_query:", error.message);
        try {
          await bot.answerCallbackQuery(query.id, { text: "❌ Erro ao processar requisição" });
        } catch (answerError) {
          console.error("❌ Erro ao responder callback:", answerError.message);
        }
      }
    });

    // ==================== HANDLER: MENSAGENS DE TEXTO ====================
    bot.on("message", async (msg) => {
      try {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const texto = msg.text ? msg.text.trim() : "";

        // Ignorar comandos já tratados
        if (texto.startsWith("/start") || texto.startsWith("/menu")) {
          return;
        }

        console.log(`💬 Mensagem recebida de ${userId}: "${texto}"`);

        // Se o usuário enviar número ou endereço USDT, processa saque
        if (/^\+?\d{7,15}$/.test(texto) || /^T[a-zA-Z0-9]{33}$/.test(texto)) {
          await executarComRetry(async () => {
            const saldoSnap = await global.db.ref(`saldos/${userId}`).once("value", null, { timeout: 30000 });
            const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

            if (saldo.usd > 0 || saldo.kz > 0) {
              await global.db.ref(`saldos/${userId}`).set({ usd: 0, kz: 0 });
              await enviarMensagemComBloqueio(chatId, "✅ Levantamento realizado com sucesso! Verifique sua carteira ou conta bancária.");
              console.log(`💸 Saque processado para usuário ${userId}`);
            } else {
              await enviarMensagemComBloqueio(chatId, "⚠️ Você não possui saldo disponível para saque.");
            }
          });
        } else {
          await enviarMensagemComBloqueio(chatId, "⚠️ Não entendi sua mensagem. Voltando ao menu principal...");
          await mostrarMenu(chatId);
        }
      } catch (error) {
        console.error("❌ Erro ao processar texto:", error.message);
        try {
          await enviarMensagemComBloqueio(msg.chat.id, "❌ Ocorreu um erro ao processar sua mensagem.");
        } catch (sendError) {
          console.error("❌ Erro ao enviar mensagem de erro:", sendError.message);
        }
      }
    });

    return true;
  } catch (error) {
    console.error("❌ Erro ao inicializar Bot Telegram:", error.message);
    console.error("\n📌 Dicas de resolução:");
    console.error("   - Verifique se a variável TELEGRAM_TOKEN está configurada");
    console.error("   - Confirme que o token é válido no @BotFather");
    process.exit(1);
  }
}

// ==================== MENSAGENS PERSUASIVAS DIÁRIAS ====================
const mensagensFicticias = [
  "📢 Guru da Mineração: 💎 Faça staking hoje e aumente seus ganhos!",
  "🏆 Ranking atualizado: os maiores mineradores estão lucrando pesado!",
  "🚀 BELIEVE MINER está crescendo rápido, não fique de fora!",
  "💡 Dica do dia: convide amigos e multiplique seus lucros!",
  "🔥 Staking ativo: quem mantém saldo ganha mais recompensas!"
];

async function mensagensDiarias() {
  try {
    console.log('📤 Enviando mensagens diárias...');
    let enviadas = 0;
    let bloqueados = 0;
    let erros = 0;

    const snapshot = await global.db.ref('usuarios').once('value', null, { timeout: 60000 });
    const usuarios = snapshot.val() || {};
    const mensagem = mensagensFicticias[Math.floor(Math.random() * mensagensFicticias.length)];

    for (const chatId in usuarios) {
      try {
        // ✅ Tratamento de erro 403
        await bot.sendMessage(chatId, mensagem).catch((err) => {
          if (err.response && err.response.statusCode === 403) {
            console.log(`🚫 Usuário ${chatId} bloqueou o bot (erro 403)`);
            bloqueados++;
          } else {
            throw err;
          }
        });
        enviadas++;
      } catch (error) {
        erros++;
        console.error(`❌ Erro ao enviar para ${chatId}:`, error.message);
      }
    }

    console.log(`✅ Mensagens diárias: ${enviadas} enviadas, ${bloqueados} bloqueados, ${erros} erros`);
  } catch (error) {
    console.error('❌ Erro ao enviar mensagens diárias:', error);
  }
}

// Envia 2 vezes por dia (12h de intervalo)
const intervaloMensagens = 12 * 60 * 60 * 1000;
setTimeout(() => {
  mensagensDiarias();
  setInterval(mensagensDiarias, intervaloMensagens);
}, 60 * 1000);

// ==================== RANKING SEMANAL ====================
async function rankingSemanal() {
  try {
    console.log('📊 Gerando ranking semanal...');
    const snapshot = await global.db.ref('saldos').once('value', null, { timeout: 60000 });
    const saldos = snapshot.val() || {};

    const ranking = Object.keys(saldos)
      .map(userId => ({
        userId,
        usd: saldos[userId].usd || 0,
        kz: saldos[userId].kz || 0
      }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 10);

    let mensagemRanking = "🏆 TOP 10 MINERADORES DA SEMANA 🏆\n\n";
    ranking.forEach((item, index) => {
      mensagemRanking += `${index + 1}. Usuário ${item.userId}: ${item.usd.toFixed(2)} USD | ${item.kz} KZ\n`;
    });

    const usuariosSnapshot = await global.db.ref('usuarios').once('value', null, { timeout: 60000 });
    const usuarios = usuariosSnapshot.val() || {};

    let enviadas = 0;
    let bloqueados = 0;
    let erros = 0;

    for (const chatId in usuarios) {
      try {
        // ✅ Tratamento de erro 403
        await bot.sendMessage(chatId, mensagemRanking).catch((err) => {
          if (err.response && err.response.statusCode === 403) {
            console.log(`🚫 Usuário ${chatId} bloqueou o bot (erro 403)`);
            bloqueados++;
          } else {
            throw err;
          }
        });
        enviadas++;
      } catch (error) {
        erros++;
        console.error(`❌ Erro ao enviar ranking para ${chatId}:`, error.message);
      }
    }

    console.log(`✅ Ranking: ${enviadas} enviados, ${bloqueados} bloqueados, ${erros} erros`);
  } catch (error) {
    console.error('❌ Erro ao enviar ranking semanal:', error);
  }
}

// Envia ranking 1 vez por semana
const intervaloRanking = 7 * 24 * 60 * 60 * 1000;
setTimeout(() => {
  rankingSemanal();
  setInterval(rankingSemanal, intervaloRanking);
}, 2 * 60 * 1000);

// ==================== AGENDAMENTO AUTOMÁTICO COM NODE-CRON ====================
console.log("\n📅 Configurando agendamento automático de mensagens...\n");

// ✅ Horários fixos: 9h, 16h e 22h
const horariosAgendados = ["09:00", "16:00", "22:00"];

horariosAgendados.forEach((horario) => {
  const [hora, minuto] = horario.split(":");
  
  // Formato cron: minuto hora * * *
  const cronExpression = `${minuto} ${hora} * * *`;
  
  cron.schedule(cronExpression, async () => {
    console.log(`\n⏰ [${new Date().toLocaleTimeString('pt-BR')}] ⏰ Acionando envio automático agendado para ${horario}...\n`);
    await enviarMensagensAutomaticas();
  });
  
  console.log(`   ✅ Agendamento criado para ${horario} (Cron: ${cronExpression})`);
});

// ✅ Função para enviar mensagens automáticas agendadas
async function enviarMensagensAutomaticas() {
  try {
    console.log('📤 [AGENDADO] Enviando mensagens automáticas...');
    let enviadas = 0;
    let bloqueados = 0;
    let erros = 0;

    const snapshot = await global.db.ref('usuarios').once('value', null, { timeout: 60000 });
    const usuarios = snapshot.val() || {};
    
    // ✅ Mensagem automática padrão
    const mensagemAutomatica = "🤖 Mensagem automática do bot\n\n⏰ Verifique seus ganhos agora mesmo! 💰";

    for (const chatId in usuarios) {
      try {
        // ✅ Tratamento de erro 403 - usuário bloqueou o bot
        await bot.sendMessage(chatId, mensagemAutomatica).catch((err) => {
          if (err.response && err.response.statusCode === 403) {
            console.log(`🚫 [${new Date().toLocaleTimeString('pt-BR')}] Usuário ${chatId} bloqueou o bot (erro 403)`);
            bloqueados++;
          } else {
            throw err;
          }
        });
        enviadas++;
      } catch (error) {
        erros++;
        console.error(`❌ Erro ao enviar para ${chatId}:`, error.message);
      }
    }

    console.log(`✅ [${new Date().toLocaleTimeString('pt-BR')}] Mensagens automáticas: ${enviadas} enviadas, ${bloqueados} bloqueados, ${erros} erros\n`);
  } catch (error) {
    console.error('❌ Erro ao enviar mensagens automáticas:', error);
  }
}

// ==================== INICIALIZAR TUDO ====================
async function inicializar() {
  await inicializarFirebase();
  inicializarBotTelegram();
}

// Executar inicialização
inicializar().catch((error) => {
  console.error("❌ Erro fatal na inicialização:", error.message);
  process.exit(1);
});

// ==================== TRATAMENTO DE EXCEÇÕES ====================
process.on("unhandledRejection", (reason) => {
  console.error("❌ Promise rejection não tratada:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Exceção não capturada:", error.message);
  console.log("⏳ Reiniciando em 5 segundos...");
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

// ==================== GRACEFUL SHUTDOWN ====================
process.once('SIGINT', () => {
  console.log('\n⏹️ Parando bot gracefully (SIGINT)...');
  if (bot) bot.stopPolling();
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('\n⏹️ Parando bot gracefully (SIGTERM)...');
  if (bot) bot.stopPolling();
  process.exit(0);
});

// ==================== MANTER PROCESSO VIVO ====================
setInterval(() => {
  // Ping silencioso para manter conexão ativa
}, 30000);

console.log("╔════════════════════════════════════════╗");
console.log("║  🤖 BOT PRONTO PARA RECEBER MENSAGENS   ║");
console.log("╚════════════════════════════════════════╝\n");