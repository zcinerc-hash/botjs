
const admin = require("firebase-admin");
const TelegramBot = require("node-telegram-bot-api");

// Inicializar o bot do Telegram
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// Inicializa Firebase usando variáveis de ambiente
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
  databaseURL: "https://nzilaexpo-default-rtdb.firebaseio.com"
});

const db = admin.database();

// ==================== VERIFICAR CONEXÃO FIREBASE ====================
db.ref('.info/connected').on('value', (snap) => {
  if (snap.val() === true) {
    console.log('✅ [' + new Date().toISOString() + '] Conectado ao Firebase!');
  } else {
    console.log('⚠️ [' + new Date().toISOString() + '] Desconectado do Firebase - Tentando reconectar...');
  }
});

// ==================== INICIALIZAR BOT TELEGRAM ====================
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

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

// ==================== VERIFICAR SE USUÁRIO É NOVO ====================
async function isNovoUsuario(userId) {
  return executarComRetry(async () => {
    const snapshot = await db.ref(`usuarios/${userId}`).once('value', null, { timeout: 30000 });
    return !snapshot.exists();
  });
}

// ==================== SALVAR CONVITE ====================
async function salvarConvite(donoId, convidadoId) {
  return executarComRetry(async () => {
    const ref = db.ref(`convites/${donoId}`);
    const snapshot = await ref.once('value', null, { timeout: 30000 });
    const convites = snapshot.val() || [];

    const jaExiste = convites.some(c => c.convidado === convidadoId);
    if (jaExiste) {
      await bot.sendMessage(donoId, "⚠️ Esse usuário já foi convidado anteriormente...");
      return;
    }

    convites.push({ convidado: convidadoId, data: new Date().toISOString() });
    await ref.set(convites);

    const saldoRef = db.ref(`saldos/${donoId}`);
    const saldoSnap = await saldoRef.once('value', null, { timeout: 30000 });
    const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

    saldo.usd += 0.5;
    saldo.kz += 500;
    await saldoRef.set(saldo);

    let mensagem = `🎉 Você convidou ${convites.length} pessoas únicas! Parabéns!\n💰 Saldo atualizado: ${saldo.usd.toFixed(2)} USD | ${saldo.kz} KZ`;

    if (convites.length >= 15) {
      mensagem += "\n🏆 WIN! Você atingiu 15 convites e ganhou bônus especial!";
    }

    await bot.sendMessage(donoId, mensagem);
  });
}

// ==================== MENU PRINCIPAL ====================
async function mostrarMenu(chatId) {
  try {
    await bot.sendMessage(
      chatId,
      `🚀 BELIEVE MINER – A Nova Era da Mineração Digital 🌍
💎 Ganhe lucros internacionais agora mesmo!`,
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

// ==================== MENSAGEM DE BOAS-VINDAS ====================
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
    );
  } catch (error) {
    console.error('Erro ao enviar boas-vindas:', error);
  }
}


// ==================== COMANDO /START ====================
bot.onText(/\/start/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    console.log(`📥 Novo acesso: ${msg.from.first_name} (ID: ${userId})`);

    const novoUsuario = await isNovoUsuario(userId);

    await executarComRetry(async () => {
      await db.ref(`usuarios/${userId}`).set({
        nome: msg.from.first_name,
        data: new Date().toISOString()
      });
    });

    if (novoUsuario) {
      await enviarMensagemBoasVindas(chatId);
      setTimeout(async () => {
        await mostrarMenu(chatId);
      }, 3000);
    } else {
      await mostrarMenu(chatId);
    }

    // Processa convite se houver payload (parâmetro start)
    if (msg.text.includes("start=")) {
      const payload = msg.text.split("start=")[1];
      if (payload) {
        await salvarConvite(payload, userId);
      }
    }
  } catch (error) {
    console.error('❌ Erro no comando /start:', error);
    await bot.sendMessage(chatId, "❌ Ocorreu um erro. Tente novamente em alguns segundos.");
  }
});

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
      const snapshot = await db.ref(`convites/${userId}`).once('value', null, { timeout: 30000 });
      const convites = snapshot.val() || [];
      await bot.sendMessage(chatId, `👥 Você já convidou ${convites.length} pessoas únicas.`);
    }

    if (data === "meu_saldo") {
      const saldoSnap = await db.ref(`saldos/${userId}`).once('value', null, { timeout: 30000 });
      const saldo = saldoSnap.val() || { usd: 0, kz: 0 };
      await bot.sendMessage(chatId, `💰 Seu saldo: ${saldo.usd.toFixed(2)} USD | ${saldo.kz} KZ`);
    }

    if (data === "retirar_saldo") {
      const saldoSnap = await db.ref(`saldos/${userId}`).once('value', null, { timeout: 30000 });
      const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

      if (saldo.usd <= 0 && saldo.kz <= 0) {
        await bot.sendMessage(chatId, "⚠️ Você não possui saldo disponível para saque.");
      } else {
        await bot.sendMessage(chatId, "🏦 Para retirar seu saldo, envie:\n\n📱 Seu número de celular internacional associado ao banco\nou\n💳 Endereço USDT (TRON20 Tether)\n\nAssim que enviar, o saque será processado com sucesso.");
      }
    }

    await bot.answerCallbackQuery(query.id);
  } catch (error) {
    console.error('❌ Erro no callback_query:', error);
    await bot.answerCallbackQuery(query.id, { text: '❌ Erro ao processar requisição' });
  }
});

// ==================== FALLBACK: QUALQUER TEXTO NÃO RECONHECIDO ====================
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const texto = msg.text.trim();

    if (/^\+?\d{7,15}$/.test(texto) || /^T[a-zA-Z0-9]{33}$/.test(texto)) {
      const saldoSnap = await db.ref(`saldos/${userId}`).once('value', null, { timeout: 30000 });
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
    console.error('❌ Erro ao processar texto:', error);
    await bot.sendMessage(msg.chat.id, "❌ Ocorreu um erro ao processar sua mensagem.");
  }
});

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
    const snapshot = await db.ref('usuarios').once('value', null, { timeout: 60000 });
    const usuarios = snapshot.val() || {};
    const mensagem = mensagensFicticias[Math.floor(Math.random() * mensagensFicticias.length)];

    let enviadas = 0;
    let erros = 0;

    for (const chatId in usuarios) {
      try {
        await bot.sendMessage(chatId, mensagem);
        enviadas++;
      } catch (error) {
        erros++;
        console.error(`❌ Erro ao enviar para ${chatId}:`, error.message);
      }
    }

    console.log(`✅ Mensagens diárias: ${enviadas} enviadas, ${erros} erros`);
  } catch (error) {
    console.error('❌ Erro ao enviar mensagens diárias:', error);
  }
}

const intervaloMensagens = 12 * 60 * 60 * 1000;
setTimeout(() => {
  mensagensDiarias();
  setInterval(mensagensDiarias, intervaloMensagens);
}, 60 * 1000);

// ==================== RANKING SEMANAL ====================
async function rankingSemanal() {
  try {
    console.log('📊 Gerando ranking semanal...');
    const snapshot = await db.ref('saldos').once('value', null, { timeout: 60000 });
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

    const usuariosSnapshot = await db.ref('usuarios').once('value', null, { timeout: 60000 });
    const usuarios = usuariosSnapshot.val() || {};

    let enviadas = 0;
    let erros = 0;

    for (const chatId in usuarios) {
      try {
        await bot.sendMessage(chatId, mensagemRanking);
        enviadas++;
      } catch (error) {
        erros++;
        console.error(`❌ Erro ao enviar ranking para ${chatId}:`, error.message);
      }
    }

    console.log(`✅ Ranking: ${enviadas} enviados, ${erros} erros`);
  } catch (error) {
    console.error('❌ Erro ao enviar ranking semanal:', error);
  }
}

const intervaloRanking = 7 * 24 * 60 * 60 * 1000;
setTimeout(() => {
  rankingSemanal();
  setInterval(rankingSemanal, intervaloRanking);
}, 2 * 60 * 1000);

// ==================== INICIAR BOT ====================
console.log('✅ Bot iniciado com sucesso!');
console.log('📌 Bot rodando em polling mode...');
