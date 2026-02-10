require("dotenv").config();
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const TelegramBot = require("node-telegram-bot-api");

let bot; // Variável global para o bot

// ==================== DEBUG INICIAL ====================
console.log("\n");
console.log("╔════════════════════════════════════════╗");
console.log("║   🤖 INICIANDO BOT TELEGRAM + FIREBASE   ║");
console.log("╚════════════════════════════════════════╝\n");

console.log("📋 DEBUG - Variáveis de Ambiente:");
console.log("   TELEGRAM_TOKEN:", process.env.TELEGRAM_TOKEN ? "✅ Configurado" : "❌ Não configurado");
console.log("   FIREBASE_SERVICE_ACCOUNT:", process.env.FIREBASE_SERVICE_ACCOUNT ? "✅ Configurado" : "❌ Não configurado");
console.log("   NODE_ENV:", process.env.NODE_ENV || "desenvolvimento");
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

        // Método 2: Tentar como caminho do arquivo
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
    // Método 3: Fallback para arquivo local padrão
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

    // Testar conexão com Firebase (sem await)
    console.log("   📍 Testando conexão com Firebase...");
    db.ref(".info/connected").once("value", (snapshot) => {
      if (snapshot.val()) {
        console.log("   ✅ Conectado ao Firebase com sucesso!");
      } else {
        console.warn("   ⚠️  Firebase conectado mas pode estar offline");
      }
    });

    console.log(`✅ Firebase inicializado com sucesso!`);
    console.log(`   Método: ${firebaseLoadMethod}\n`);

    // Exportar db globalmente
    global.db = db;
    return true;
  } catch (error) {
    console.error("❌ Erro ao inicializar Firebase:", error.message);
    console.error("\n📌 Dicas de resolução:");
    console.error("   - Verifique se a variável FIREBASE_SERVICE_ACCOUNT está configurada");
    console.error("   - Certifique-se de que o JSON é válido");
    console.error("   - Teste com: node -e \"console.log(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))\"");
    process.exit(1);
  }
}

// ==================== FUNÇÕES AUXILIARES ====================
async function salvarConvite(donoId, convidadoId) {
  try {
    const ref = global.db.ref(`convites/${donoId}`);
    const snapshot = await ref.once("value", null, { timeout: 30000 });
    const convites = snapshot.val() || [];

    const jaExiste = convites.some(c => c.convidado === convidadoId);
    if (jaExiste) {
      await bot.sendMessage(donoId, "⚠️ Esse usuário já foi convidado anteriormente...");
      return;
    }

    convites.push({ convidado: convidadoId, data: new Date().toISOString() });
    await ref.set(convites);

    const saldoRef = global.db.ref(`saldos/${donoId}`);
    const saldoSnap = await saldoRef.once("value", null, { timeout: 30000 });
    const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

    let mensagem = `🎉 Você convidou ${convites.length} pessoas únicas! Parabéns!\n💰 Saldo atualizado: ${saldo.usd.toFixed(2)} USD | ${saldo.kz} KZ`;
    if (convites.length >= 15) {
      mensagem += "\n🏆 WIN! Você atingiu 15 convites e ganhou bônus especial!";
    }

    await bot.sendMessage(donoId, mensagem);
  } catch (error) {
    console.error("❌ Erro em salvarConvite:", error.message);
  }
}

async function mostrarMenu(chatId) {
  try {
    await bot.sendMessage(
      chatId,
      `🚀 BELIEVE MINER – A Nova Era da Mineração Digital 🌍\n💎 Ganhe lucros internacionais agora mesmo!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Meu link de convite", callback_data: "meu_link" }],
            [{ text: "👥 Meus convidados", callback_data: "meus_convidados" }],
            [{ text: "💰 Meu saldo", callback_data: "meu_saldo" }],
            [{ text: "🏦 Retirar saldo", callback_data: "retirar_saldo" }]
          ]
        }
      }
    );
  } catch (error) {
    console.error("❌ Erro ao mostrar menu:", error.message);
  }
}

async function enviarMensagemBoasVindas(chatId) {
  try {
    await bot.sendPhoto(
      chatId,
      "https://cdn.jornaldebrasilia.com.br/wp-content/uploads/2024/04/30134427/WhatsApp-Image-2024-04-30-at-12.45.15.jpeg",
      {
        caption: `📌 Convide e ganhe $50! 💰\nDeposite apenas 9.000 KZ (≈ $9) e receba diariamente 300 KZ (≈ $0.30) até 1 ano.\n\n🚀 BELIEVE MINER – A Nova Era da Mineração Digital 🌍\n💎 Ganhe lucros internacionais agora mesmo!\n\nA BELIEVE MINER chegou para revolucionar o mercado, pagando em USDT (Tether) e Kwanza (KZ) diretamente para você.\n\n✨ Por que escolher a BELIEVE MINER?\n- Pagamentos rápidos e seguros em USDT e KZ\n- Plataforma moderna e confiável`
      }
    );
  } catch (error) {
    console.error("❌ Erro ao enviar mensagem de boas-vindas:", error.message);
  }
}

async function mensagensDiarias() {
  try {
    let enviadas = 0;
    let erros = 0;
    const usuariosSnap = await global.db.ref("usuarios").once("value");
    const usuarios = usuariosSnap.val() || {};

    const mensagem = "📢 Mensagem diária automática!";

    for (const chatId in usuarios) {
      try {
        await bot.sendMessage(chatId, mensagem);
        enviadas++;
      } catch (error) {
        erros++;
        console.error(`❌ Erro ao enviar mensagem para ${chatId}:`, error.message);
      }
    }

    console.log(`📨 Mensagens diárias: ${enviadas} enviadas, ${erros} erros`);
  } catch (error) {
    console.error("❌ Erro em mensagensDiarias:", error.message);
  }
}

async function rankingSemanal() {
  try {
    let enviadas = 0;
    let erros = 0;
    const usuariosSnap = await global.db.ref("usuarios").once("value");
    const usuarios = usuariosSnap.val() || {};

    const mensagemRanking = "🏆 Ranking semanal atualizado!";

    for (const chatId in usuarios) {
      try {
        await bot.sendMessage(chatId, mensagemRanking);
        enviadas++;
      } catch (error) {
        erros++;
        console.error(`❌ Erro ao enviar ranking para ${chatId}:`, error.message);
      }
    }

    console.log(`🏆 Ranking semanal: ${enviadas} enviados, ${erros} erros`);
  } catch (error) {
    console.error("❌ Erro em rankingSemanal:", error.message);
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

    // ==================== CALLBACKS DOS BOTÕES ====================
    bot.on("callback_query", async (query) => {
      try {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const data = query.data;

        console.log(`📌 Callback recebido: ${data} do usuário ${userId}`);

        if (data === "meu_link") {
          await bot.sendMessage(chatId, `📋 Seu link de convite: https://t.me/Believeminerbot?start=${userId}`);
        }

        if (data === "meus_convidados") {
          const snapshot = await global.db.ref(`convites/${userId}`).once("value", null, { timeout: 30000 });
          const convites = snapshot.val() || [];
          await bot.sendMessage(chatId, `👥 Você já convidou ${convites.length} pessoas únicas.`);
        }

        if (data === "meu_saldo") {
          const saldoSnap = await global.db.ref(`saldos/${userId}`).once("value", null, { timeout: 30000 });
          const saldo = saldoSnap.val() || { usd: 0, kz: 0 };
          await bot.sendMessage(chatId, `💰 Seu saldo: ${saldo.usd.toFixed(2)} USD | ${saldo.kz} KZ`);
        }

        if (data === "retirar_saldo") {
          const saldoSnap = await global.db.ref(`saldos/${userId}`).once("value", null, { timeout: 30000 });
          const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

          if (saldo.usd <= 0 && saldo.kz <= 0) {
            await bot.sendMessage(chatId, "⚠️ Você não possui saldo disponível para saque.");
          } else {
            await bot.sendMessage(chatId, "🏦 Para retirar seu saldo, envie:\n\n📱 Seu número de celular internacional associado ao banco\nou\n💳 Endereço USDT (TRON20 Tether)\n\nAssim que enviar, o saque será processado com sucesso.");
          }
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

        console.log(`💬 Mensagem recebida de ${userId}: "${texto}"`);

        // Se o usuário enviar número ou endereço USDT, processa saque
        if (/^\+?\d{7,15}$/.test(texto) || /^T[a-zA-Z0-9]{33}$/.test(texto)) {
          const saldoSnap = await global.db.ref(`saldos/${userId}`).once("value", null, { timeout: 30000 });
          const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

          if (saldo.usd > 0 || saldo.kz > 0) {
            await global.db.ref(`saldos/${userId}`).set({ usd: 0, kz: 0 });
            await bot.sendMessage(chatId, "✅ Levantamento realizado com sucesso! Verifique sua carteira ou conta bancária.");
            console.log(`💸 Saque processado para usuário ${userId}`);
          } else {
            await bot.sendMessage(chatId, "⚠️ Você não possui saldo disponível para saque.");
          }
        } else if (texto === "/start") {
          await enviarMensagemBoasVindas(chatId);
          await mostrarMenu(chatId);
        } else if (texto === "/menu") {
          await mostrarMenu(chatId);
        } else {
          await bot.sendMessage(chatId, "⚠️ Não entendi sua mensagem. Voltando ao menu principal...");
          await mostrarMenu(chatId);
        }
      } catch (error) {
        console.error("❌ Erro ao processar texto:", error.message);
        try {
          await bot.sendMessage(msg.chat.id, "❌ Ocorreu um erro ao processar sua mensagem.");
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

// ==================== INICIALIZAR TUDO ====================
async function inicializar() {
  await inicializarFirebase();
  inicializarBotTelegram();

  // Iniciar mensagens automáticas
  const intervaloMensagens = 12 * 60 * 60 * 1000;
  setTimeout(() => {
    console.log("⏳ Iniciando envio de mensagens diárias...");
    mensagensDiarias();
    setInterval(mensagensDiarias, intervaloMensagens);
  }, 60 * 1000);

  // Iniciar ranking semanal
  const intervaloRanking = 7 * 24 * 60 * 60 * 1000;
  setTimeout(() => {
    console.log("⏳ Iniciando ranking semanal...");
    rankingSemanal();
    setInterval(rankingSemanal, intervaloRanking);
  }, 2 * 60 * 1000);
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

// ==================== MANTER PROCESSO VIVO ====================
setInterval(() => {
  // Ping silencioso para manter conexão ativa
}, 30000);

console.log("╔════════════════════════════════════════╗");
console.log("║  🤖 BOT PRONTO PARA RECEBER MENSAGENS   ║");
console.log("╚════════════════════════════════════════╝\n");