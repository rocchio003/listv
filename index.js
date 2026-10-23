module.exports = async (req, res) => {
    // Gestisce solo le richieste verso /lista.m3u
    if (!req.url.startsWith('/lista.m3u')) {
        return res.status(404).send("Pagina non trovata. Usa /lista.m3u");
    }

    const passwordRichiesta = process.env.PASSWORD_ACCESSO || "Miapassword123!";
    const passwordFornita = req.query.pw;

    if (!passwordFornita || passwordFornita !== passwordRichiesta) {
        return res.status(403).send("Errore: Password non valida nell'URL.");
    }

    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="lista_unificata.m3u"');
    
    let outputM3U = "#EXTM3U\n";

    const fetchOptions = {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(12000)
    };

    // 1. Liste M3U
    const m3uEnv = process.env.LISTE_M3U;
    if (m3uEnv) {
        const urlListe = m3uEnv.split(',').map(url => url.trim());
        for (const url of urlListe) {
            if (url && url.startsWith('http')) {
                try {
                    const response = await fetch(url, fetchOptions);
                    if (response.ok) {
                        const testo = await response.text();
                        const testoPulito = testo.replace(/#EXTM3U\r?\n/g, "").trim();
                        if (testoPulito) outputM3U += testoPulito + "\n";
                    }
                } catch (e) {
                    console.error("Errore M3U:", e.message);
                }
            }
        }
    }

    // 2. Xtream Codes
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

                if (urlBase.startsWith('http')) {
                    try {
                        const response = await fetch(xtreamUrl, fetchOptions);
                        if (response.ok) {
                            const testo = await response.text();
                            const testoPulito = testo.replace(/#EXTM3U\r?\n/g, "").trim();
                            if (testoPulito) outputM3U += testoPulito + "\n";
                        }
                    } catch (e) {
                        console.error("Errore Xtream:", e.message);
                    }
                }
            }
        }
    }

    return res.send(outputM3U);
};
