const admin = require("firebase-admin");
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

    // Verifica se o convidado já existe
    const jaExiste = convites.some(c => c.convidado === convidadoId);
    if (jaExiste) {
     await bot.sendMessage(donoId, "⚠️ Esse usuário já foi convidado anteriormente...");

      return;
    }

    convites.push({ convidado: convidadoId, data: new Date().toISOString() });
    await ref.set(convites);

    // Atualiza saldo do dono (0.5 USD ≈ 500 KZ por indicação)
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
async function mostrarMenu(ctx) {
  try {
    await ctx.reply(
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

// ==================== MENSAGEM DE BOAS-VINDAS ÚNICA ====================
async function enviarMensagemBoasVindas(ctx) {
  try {
    await ctx.replyWithPhoto(
      { url: "https://cdn.jornaldebrasilia.com.br/wp-content/uploads/2024/04/30134427/WhatsApp-Image-2024-04-30-at-12.45.15.jpeg" },
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
    );
  } catch (error) {
    console.error('Erro ao enviar boas-vindas:', error);
  }
}

// ==================== COMANDO /START (ÚNICO) ====================
bot.start(async (ctx) => {
  try {
    const payload = ctx.startPayload;
    const userId = ctx.from.id;

    console.log(`📥 Novo acesso: ${ctx.from.first_name} (ID: ${userId})`);

    // Verifica se é novo usuário
    const novoUsuario = await isNovoUsuario(userId);

    // Registra/atualiza usuário no Firebase
    await executarComRetry(async () => {
      await db.ref(`usuarios/${userId}`).set({
        nome: ctx.from.first_name,
        data: new Date().toISOString()
      });
    });

    // Se é novo usuário, envia mensagem de boas-vindas única
    if (novoUsuario) {
      await enviarMensagemBoasVindas(ctx);

      // Aguarda 3 segundos antes de mostrar o menu
      setTimeout(async () => {
        await mostrarMenu(ctx);
      }, 3000);
    } else {
      // Se já é usuário existente, mostra direto o menu
      await mostrarMenu(ctx);
    }

    // Processa convite se houver payload
    if (payload) {
      await salvarConvite(payload, userId);
    }
  } catch (error) {
    console.error('❌ Erro no comando /start:', error);
    try {
      await ctx.reply("❌ Ocorreu um erro. Tente novamente em alguns segundos.");
    } catch (e) {
      console.error('Erro ao responder no /start:', e);
    }
  }
});

// ==================== CALLBACKS DOS BOTÕES ====================
bot.on('callback_query', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const data = ctx.callbackQuery.data;

    if (data === "meu_link") {
      await ctx.reply(`📋 Seu link de convite: https://t.me/Believeminerbot?start=${userId}`);
      await ctx.answerCbQuery();
    }

    if (data === "meus_convidados") {
      await executarComRetry(async () => {
        const snapshot = await db.ref(`convites/${userId}`).once('value', null, { timeout: 30000 });
        const convites = snapshot.val() || [];
        await ctx.reply(`👥 Você já convidou ${convites.length} pessoas únicas.`);
      });
      await ctx.answerCbQuery();
    }

    if (data === "meu_saldo") {
      await executarComRetry(async () => {
        const saldoSnap = await db.ref(`saldos/${userId}`).once('value', null, { timeout: 30000 });
        const saldo = saldoSnap.val() || { usd: 0, kz: 0 };
        await ctx.reply(`💰 Seu saldo: ${saldo.usd.toFixed(2)} USD | ${saldo.kz} KZ`);
      });
      await ctx.answerCbQuery();
    }

    if (data === "retirar_saldo") {
      await executarComRetry(async () => {
        const saldoSnap = await db.ref(`saldos/${userId}`).once('value', null, { timeout: 30000 });
        const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

        if (saldo.usd <= 0 && saldo.kz <= 0) {
          await ctx.reply("⚠️ Você não possui saldo disponível para saque.");
        } else {
          await ctx.reply("🏦 Para retirar seu saldo, envie:\n\n📱 Seu número de celular internacional associado ao banco\nou\n💳 Endereço USDT (TRON20 Tether)\n\nAssim que enviar, o saque será processado com sucesso.");
        }
      });
      await ctx.answerCbQuery();
    }
  } catch (error) {
    console.error('❌ Erro no callback_query:', error);
    try {
      await ctx.answerCbQuery('❌ Erro ao processar requisição');
    } catch (e) {
      console.error('Erro ao responder callback:', e);
    }
  }
});

// ==================== FALLBACK: QUALQUER TEXTO NÃO RECONHECIDO ====================
bot.on('text', async (ctx) => {
  try {
    const texto = ctx.message.text.trim();
    const userId = ctx.from.id;

    // Se o usuário enviar número ou endereço USDT, processa saque
    if (/^\+?\d{7,15}$/.test(texto) || /^T[a-zA-Z0-9]{33}$/.test(texto)) {
      await executarComRetry(async () => {
        const saldoSnap = await db.ref(`saldos/${userId}`).once('value', null, { timeout: 30000 });
        const saldo = saldoSnap.val() || { usd: 0, kz: 0 };

        if (saldo.usd > 0 || saldo.kz > 0) {
          // Zera saldo após saque
          await db.ref(`saldos/${userId}`).set({ usd: 0, kz: 0 });
          await ctx.reply("✅ Levantamento realizado com sucesso! Verifique sua carteira ou conta bancária.");
          console.log(`💸 Saque processado para usuário ${userId}`);
        } else {
          await ctx.reply("⚠️ Você não possui saldo disponível para saque.");
        }
      });
    } else {
      await ctx.reply("⚠️ Não entendi sua mensagem. Voltando ao menu principal...");
      await mostrarMenu(ctx);
    }
  } catch (error) {
    console.error('❌ Erro ao processar texto:', error);
    try {
      await ctx.reply("❌ Ocorreu um erro ao processar sua mensagem.");
    } catch (e) {
      console.error('Erro ao responder texto:', e);
    }
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
        await bot.telegram.sendMessage(chatId, mensagem);
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

// Envia 2 vezes por dia (12h de intervalo) - Primeira execução após 1 minuto
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
        await bot.telegram.sendMessage(chatId, mensagemRanking);
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

// Envia ranking 1 vez por semana (a cada 7 dias) - Primeira execução após 2 minutos
const intervaloRanking = 7 * 24 * 60 * 60 * 1000;
setTimeout(() => {
  rankingSemanal();
  setInterval(rankingSemanal, intervaloRanking);
}, 2 * 60 * 1000);

// ==================== INICIAR BOT ====================
async function iniciarBot() {
  try {
    await bot.launch();
    console.log('✅ Bot iniciado com sucesso!');
    console.log('📌 Bot rodando em polling mode...');
  } catch (error) {
    console.error('❌ Erro ao iniciar bot:', error);
    console.log('⏳ Tentando reconectar em 10 segundos...');
    setTimeout(iniciarBot, 10000);
  }
}

iniciarBot();

// ==================== GRACEFUL SHUTDOWN ====================
process.once('SIGINT', () => {
  console.log('\n⏹️ Parando bot gracefully (SIGINT)...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('\n⏹️ Parando bot gracefully (SIGTERM)...');
  bot.stop('SIGTERM');
  process.exit(0);
});

// Trata exceções não capturadas
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejection não tratada:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Exceção não capturada:', error);
  console.log('⏳ Reiniciando em 5 segundos...');
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

// Mantém o processo vivo
setInterval(() => {
  // Ping silencioso para manter conexão ativa
}, 30000);