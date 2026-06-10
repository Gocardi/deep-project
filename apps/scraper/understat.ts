import puppeteer from 'puppeteer';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Helper para parsear strings en formato hexadecimal codificado de Understat (\x7B...)
function decodeUnderstatJson(encodedStr: string): any {
  try {
    // Reemplaza los escapes de tipo \xHH por sus caracteres reales
    const decoded = encodedStr.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
    return JSON.parse(decoded);
  } catch (e) {
    console.error('Error al decodificar JSON de Understat:', e);
    return null;
  }
}

async function scrapeUnderstatMatchPPDA(page: puppeteer.Page, matchId: string): Promise<{ homePPDA: number; awayPPDA: number } | null> {
  const matchUrl = `https://understat.com/match/${matchId}`;
  console.log(`🔍 Extrayendo PPDA del partido ${matchId}...`);
  try {
    await page.goto(matchUrl, { waitUntil: 'networkidle2' });
    const html = await page.content();
    
    // El PPDA está dentro de los scripts en la variable "statisticsData"
    const statsMatch = html.match(/var statisticsData = JSON\.parse\('([^']+)'\);/);
    if (!statsMatch) {
      console.log(`⚠️ No se encontraron estadísticas detalladas en el script del partido ${matchId}.`);
      return null;
    }
    
    const statsData = decodeUnderstatJson(statsMatch[1]);
    if (!statsData) return null;

    // Estructura de statisticsData suele ser: { "PPDA": { "h": { "value": XX, ... }, "a": { ... } } }
    // O una tabla de estadísticas donde PPDA es una de las filas
    const ppdaInfo = statsData.PPDA;
    if (ppdaInfo) {
      const homePPDA = parseFloat(ppdaInfo.h.value) || 0;
      const awayPPDA = parseFloat(ppdaInfo.a.value) || 0;
      return { homePPDA, awayPPDA };
    }

    // A veces está anidado en grupos. Busquemos en las claves
    for (const key of Object.keys(statsData)) {
      const group = statsData[key];
      if (group && group.PPDA) {
        const homePPDA = parseFloat(group.PPDA.h) || parseFloat(group.PPDA.h.value) || 0;
        const awayPPDA = parseFloat(group.PPDA.a) || parseFloat(group.PPDA.a.value) || 0;
        return { homePPDA, awayPPDA };
      }
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error al extraer PPDA para partido ${matchId}:`, error);
    return null;
  }
}

async function scrapeUnderstatSeason() {
  const url = 'https://understat.com/league/EPL/2023';
  console.log('🌍 Levantando navegador controlado para Understat...');
  
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2' });

    console.log('⏳ Buscando datos de partidos incrustados...');
    const html = await page.content();
    
    // Buscamos matchesData en el script de Understat
    const matchesMatch = html.match(/var matchesData = JSON\.parse\('([^']+)'\);/);
    if (!matchesMatch) {
      console.log('❌ Error: No se encontró "matchesData" en el HTML de Understat.');
      const pageTitle = await page.title();
      console.log(`Título de la página actual: "${pageTitle}"`);
      return;
    }

    const matchesData = decodeUnderstatJson(matchesMatch[1]);
    if (!matchesData || !Array.isArray(matchesData)) {
      console.log('❌ Error al decodificar o parsear la lista de partidos.');
      return;
    }

    console.log(`📊 Partidos totales encontrados en Understat: ${matchesData.length}`);

    let insertCount = 0;
    let skippedUnplayed = 0;

    // Procesamos solo los primeros 10 partidos para probar el scraper y la inserción de PPDA
    // para evitar hacer cientos de peticiones de golpe. El usuario puede luego expandirlo.
    const completedMatches = matchesData.filter(m => m.isResult === true);
    console.log(`✅ Partidos jugados: ${completedMatches.length}. Scrapeando los primeros 15 partidos detallados (con PPDA) para verificación.`);

    for (let i = 0; i < Math.min(completedMatches.length, 15); i++) {
      const match = completedMatches[i];
      const matchId = match.id.toString();
      const dateStr = match.datetime;
      
      const homeTeamName = match.h.title;
      const awayTeamName = match.a.title;
      
      const homeGoals = parseInt(match.goals.h, 10);
      const awayGoals = parseInt(match.goals.a, 10);
      
      const homeXG = parseFloat(match.xG.h) || 0.0;
      const awayXG = parseFloat(match.xG.a) || 0.0;

      // Extraemos el PPDA navegando a la página del partido
      let homePPDA = null;
      let awayPPDA = null;
      
      const ppdaData = await scrapeUnderstatMatchPPDA(page, matchId);
      if (ppdaData) {
        homePPDA = ppdaData.homePPDA;
        awayPPDA = ppdaData.awayPPDA;
        console.log(`   PPDA obtenido: Local ${homePPDA} - Visitante ${awayPPDA}`);
      }

      // Upsert de equipos
      const homeTeam = await prisma.team.upsert({
        where: { name: homeTeamName },
        update: {},
        create: { name: homeTeamName },
      });

      const awayTeam = await prisma.team.upsert({
        where: { name: awayTeamName },
        update: {},
        create: { name: awayTeamName },
      });

      // Upsert de partido con PPDA
      await prisma.match.upsert({
        where: { id: `understat-${matchId}` },
        update: {
          homeXG,
          awayXG,
          homePPDA,
          awayPPDA,
        },
        create: {
          id: `understat-${matchId}`,
          date: new Date(dateStr),
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          homeGoals,
          awayGoals,
          homeXG,
          awayXG,
          homePPDA,
          awayPPDA,
        },
      });

      insertCount++;
      // Pequeño delay de cortesía
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log(`\n=== RESUMEN DE PROCESAMIENTO UNDERSTAT ===`);
    console.log(`✅ Partidos guardados/actualizados con PPDA en PostgreSQL: ${insertCount}`);

  } catch (error) {
    console.error('❌ Error durante la ejecución del scraper de Understat:', error);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

scrapeUnderstatSeason();
