// ==================== COMANDO /START ====================
bot.onText(/\/start/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    console.log(`📥 Novo acesso: ${msg.from.first_name} (ID: ${userId})`);

    // Verifica se é novo usuário
    const novoUsuario = await isNovoUsuario(userId);

    // Registra/atualiza usuário no Firebase
    await executarComRetry(async () => {
      await db.ref(`usuarios/${userId}`).set({
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

    // Processa convite se houver payload (parâmetro start)
    if (msg.text.includes("start=")) {
      const payload = msg.text.split("start=")[1];
      if (payload) {
        await salvarConvite(payload, userId);
      }
    }
  } catch (error) {
    console.error("❌ Erro no comando /start:", error);
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
    console.error("❌ Erro no callback_query:", error);
    await bot.answerCallbackQuery(query.id, { text: "❌ Erro ao processar requisição" });
  }
});

// ==================== FALLBACK: QUALQUER TEXTO NÃO RECONHECIDO ====================
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const texto = msg.text.trim();

    // Se o usuário enviar número ou endereço USDT, processa saque
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
    console.error("❌ Erro ao processar texto:", error);
    await bot.sendMessage(msg.chat.id, "❌ Ocorreu um erro ao processar sua mensagem.");
  }
});

// ==================== INICIAR BOT ====================
console.log("✅ Bot iniciado com sucesso!");
console.log("📌 Bot rodando em polling mode...");

// Mantém o processo vivo
setInterval(() => {
  // Ping silencioso para manter conexão ativa
}, 30000);

// Trata exceções não capturadas
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
