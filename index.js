const express = require('express');
const app = express();

app.get('/lista.m3u', async (req, res) => {
    // Recupera la password e i dati inseriti nelle impostazioni di Vercel
    const passwordRichiesta = process.env.PASSWORD_ACCESSO || "Miapassword123!";
    const passwordFornita = req.query.pw;

    // Controllo di sicurezza: Sparkle TV deve inviare la password corretta nell'URL
    if (!passwordFornita || passwordFornita !== passwordRichiesta) {
        return res.status(403).send("Errore: Password non valida nell'URL.");
    }

    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="lista_unificata.m3u"');
    
    let outputM3U = "#EXTM3U\n";

    // 1. Elaborazione Liste M3U (prende i link separati da virgola salvati su Vercel)
    const m3uEnv = process.env.LISTE_M3U;
    if (m3uEnv) {
        const urlListe = m3uEnv.split(',').map(url => url.trim());
        for (const url of urlListe) {
            if (url) {
                try {
                    const response = await fetch(url);
                    if (response.ok) {
                        const testo = await response.text();
                        const testoPulito = testo.replace(/#EXTM3U\r?\n/, "");
                        outputM3U += testoPulito + "\n";
                    }
                } catch (e) {
                    console.error("Errore nel caricamento della M3U:", url);
                }
            }
        }
    }

    // 2. Elaborazione Credenziali Xtream Codes (URL|USER|PASS separati da virgola)
    const xtreamEnv = process.env.LISTE_XTREAM;
    if (xtreamEnv) {
        const accountXtream = xtreamEnv.split(',').map(acc => acc.trim());
        for (const account of accountXtream) {
            const parti = account.split('|');
            if (parti.length === 3) {
                const urlBase = parti[0].replace(/\/$/, "");
                const user = encodeURIComponent(parti[1]);
                const pass = encodeURIComponent(parti[2]);
                const xtreamUrl = `${urlBase}/get.php?auth_username=${user}&auth_password=${pass}&output=ts`;

                try {
                    const response = await fetch(xtreamUrl);
                    if (response.ok) {
                        const testo = await response.text();
                        const testoPulito = testo.replace(/#EXTM3U\r?\n/, "");
                        outputM3U += testoPulito + "\n";
                    }
                } catch (e) {
                    console.error("Errore nel caricamento di Xtream:", urlBase);
                }
            }
        }
    }

    res.send(outputM3U);
});

// Avvia il server locale per Vercel
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy attivo sulla porta ${PORT}`));

module.exports = app;
