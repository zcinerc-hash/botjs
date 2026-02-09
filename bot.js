const admin = require("firebase-admin");
const TelegramBot = require("node-telegram-bot-api");

// ==================== INICIALIZAÇÃO: FIREBASE COM SERVICE ACCOUNT ====================
try {
  // Ler e fazer parse da variável de ambiente
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://nzilaexpo-default-rtdb.firebaseio.com"
    });
  }

  console.log("✅ Firebase inicializado com sucesso!");
} catch (error) {
  console.error("❌ Erro ao inicializar Firebase:", error.message);
  process.exit(1);
}

const db = admin.database();

// ==================== INICIALIZAÇÃO: BOT DO TELEGRAM ====================
try {
  if (!process.env.TELEGRAM_TOKEN) {
    throw new Error("TELEGRAM_TOKEN não configurado nas variáveis de ambiente");
  }

  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

  console.log("✅ Bot Telegram iniciado com sucesso!");
  console.log("📌 Bot rodando em polling mode...");

  // ==================== FUNÇÃO DE CONVITE ====================
  async function salvarConvite(donoId, convidadoId) {
    const ref = db.ref(`convites/${donoId}`);
    const snapshot = await ref.once("value", null, { timeout: 30000 });
    const convites = snapshot.val() || [];

    const jaExiste = convites.some(c => c.convidado === convidadoId);
    if (jaExiste) {
      await bot.sendMessage(donoId, "⚠️ Esse usuário já foi convidado anteriormente...");
      return;
    }

    convites.push({ convidado: convidadoId, data: new Date().toISOString() });
    await ref.set(convites);

    const saldoRef = db.ref(`saldos/${donoId}`);
    const saldoSnap = await saldoRef.once("value", null, { timeout: 30000 });
    const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

    let mensagem = `🎉 Você convidou ${convites.length} pessoas únicas! Parabéns!\n💰 Saldo atualizado: ${saldo.usd.toFixed(2)} USD | ${saldo.kz} KZ`;
    if (convites.length >= 15) {
      mensagem += "\n🏆 WIN! Você atingiu 15 convites e ganhou bônus especial!";
    }

    await bot.sendMessage(donoId, mensagem);
  }

  // ==================== MENU PRINCIPAL ====================
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
      console.error("❌ Erro ao mostrar menu:", error);
    }
  }

  // ==================== MENSAGEM DE BOAS-VINDAS ====================
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
      console.error("❌ Erro ao enviar mensagem de boas-vindas:", error);
    }
  }

  // ==================== CALLBACKS DOS BOTÕES ====================
  bot.on("callback_query", async (query) => {
    try {
      const chatId = query.message.chat.id;
      const userId = query.from.id;
      const data = query.data;

      if (data === "meu_link") {
        await bot.sendMessage(chatId, `📋 Seu link de convite: https://t.me/Believeminerbot?start=${userId}`);
      }

      if (data === "meus_convidados") {
        const snapshot = await db.ref(`convites/${userId}`).once("value", null, { timeout: 30000 });
        const convites = snapshot.val() || [];
        await bot.sendMessage(chatId, `👥 Você já convidou ${convites.length} pessoas únicas.`);
      }

      if (data === "meu_saldo") {
        const saldoSnap = await db.ref(`saldos/${userId}`).once("value", null, { timeout: 30000 });
        const saldo = saldoSnap.val() || { usd: 0, kz: 0 };
        await bot.sendMessage(chatId, `💰 Seu saldo: ${saldo.usd.toFixed(2)} USD | ${saldo.kz} KZ`);
      }

      if (data === "retirar_saldo") {
        const saldoSnap = await db.ref(`saldos/${userId}`).once("value", null, { timeout: 30000 });
        const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

        if (saldo.usd <= 0 && saldo.kz <= 0) {
          await bot.sendMessage(chatId, "⚠️ Você não possui saldo disponível para saque.");
        } else {
          await bot.sendMessage(chatId, "🏦 Para retirar seu saldo, envie:\n\n📱 Seu número de celular internacional associado ao banco\nou\n💳 Endereço USDT (TRON20 Tether)\n\nAssim que enviar, o saque será processado com sucesso.");
        }
      }

      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error("❌ Erro no callback_query:", error);
      await bot.answerCallbackQuery(query.id, { text: "❌ Erro ao processar requisição" });
    }
  });

  // ==================== HANDLER: MENSAGENS DE TEXTO ====================
  bot.on("message", async (msg) => {
    try {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const texto = msg.text.trim();

      // Se o usuário enviar número ou endereço USDT, processa saque
      if (/^\+?\d{7,15}$/.test(texto) || /^T[a-zA-Z0-9]{33}$/.test(texto)) {
        const saldoSnap = await db.ref(`saldos/${userId}`).once("value", null, { timeout: 30000 });
        const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

        if (saldo.usd > 0 || saldo.kz > 0) {
          await db.ref(`saldos/${userId}`).set({ usd: 0, kz: 0 });
          await bot.sendMessage(chatId, "✅ Levantamento realizado com sucesso! Verifique sua carteira ou conta bancária.");
          console.log(`💸 Saque processado para usuário ${userId}`);
        } else {
          await bot.sendMessage(chatId, "⚠️ Você não possui saldo disponível para saque.");
        }
      } else {
        await bot.sendMessage(chatId, "⚠️ Não entendi sua mensagem. Voltando ao menu principal...");
        await mostrarMenu(chatId);
      }
    } catch (error) {
      console.error("❌ Erro ao processar texto:", error);
      await bot.sendMessage(msg.chat.id, "❌ Ocorreu um erro ao processar sua mensagem.");
    }
  });

  // ==================== MENSAGENS AUTOMÁTICAS DIÁRIAS ====================
  async function mensagensDiarias() {
    let enviadas = 0;
    let erros = 0;
    const usuariosSnap = await db.ref("usuarios").once("value");
    const usuarios = usuariosSnap.val() || {};

    const mensagem = "📢 Mensagem diária automática!";

    for (const chatId in usuarios) {
      try {
        await bot.sendMessage(chatId, mensagem);
        enviadas++;
      } catch (error) {
        erros++;
      }
    }

    console.log(`📨 Mensagens diárias: ${enviadas} enviadas, ${erros} erros`);
  }

  const intervaloMensagens = 12 * 60 * 60 * 1000;
  setTimeout(() => {
    mensagensDiarias();
    setInterval(mensagensDiarias, intervaloMensagens);
  }, 60 * 1000);

  // ==================== RANKING SEMANAL ====================
  async function rankingSemanal() {
    let enviadas = 0;
    let erros = 0;
    const usuariosSnap = await db.ref("usuarios").once("value");
    const usuarios = usuariosSnap.val() || {};

    const mensagemRanking = "🏆 Ranking semanal atualizado!";

    for (const chatId in usuarios) {
      try {
        await bot.sendMessage(chatId, mensagemRanking);
        enviadas++;
      } catch (error) {
        erros++;
      }
    }

    console.log(`🏆 Ranking semanal: ${enviadas} enviados, ${erros} erros`);
  }

  const intervaloRanking = 7 * 24 * 60 * 60 * 1000;
  setTimeout(() => {
    rankingSemanal();
    setInterval(rankingSemanal, intervaloRanking);
  }, 2 * 60 * 1000);

} catch (error) {
  console.error("❌ Erro ao inicializar Bot Telegram:", error.message);
  process.exit(1);
}

// ==================== TRATAMENTO DE EXCEÇÕES ====================
process.on("unhandledRejection", (reason) => {
  console.error("❌ Promise rejection não tratada:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Exceção não capturada:", error);
  console.log("⏳ Reiniciando em 5 segundos...");
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

// ==================== MANTER PROCESSO VIVO ====================
setInterval(() => {
  // Ping silencioso para manter conexão ativa
}, 30000);