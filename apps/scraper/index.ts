import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function scrapeFBrefSeason() {
  const url = 'https://fbref.com/en/comps/9/2023-2024/schedule/2023-2024-Premier-League-Scores-and-Fixtures';
  console.log('🌍 Levantando navegador controlado para saltar protección de FBref...');

  try {
    const browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await browser.newPage();
    
    // Ocultamos el flag de automatización (webdriver) para que Cloudflare no lo detecte
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Cambiamos a networkidle2 para asegurar que no haya peticiones pendientes
    await page.goto(url, { waitUntil: 'networkidle2' });

    try {
      console.log('⏳ Esperando a que la tabla de estadísticas se renderice en el DOM...');
      // FUERZA al navegador a esperar a que la tabla exista en la página
      await page.waitForSelector('table.stats_table', { timeout: 60000 });
    } catch (selectorError) {
      const pageTitle = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.error(`❌ Error esperando la tabla. Título de la página: "${pageTitle}"`);
      console.error(`Contenido inicial de la página:\n${bodyText}\n`);
      throw selectorError;
    }

    const html = await page.content();
    await browser.close();
    console.log('🔓 HTML capturado con éxito. Analizando estructura...');

    const $ = cheerio.load(html);

    // Usamos un selector más amplio para asegurar capturar las filas
    const rows = $('table.stats_table tbody tr').get();
    console.log(`📊 Filas totales detectadas en la tabla: ${rows.length}`);

    if (rows.length === 0) {
      console.log('⚠️ Alerta: El selector no encontró filas. Mostrando un fragmento del HTML capturado para revisar:');
      console.log(html.substring(0, 500));
      return;
    }

    let insertCount = 0;
    let skippedUnplayed = 0;

    for (const element of rows) {
      if ($(element).hasClass('spacer') || $(element).attr('class')?.includes('thead')) continue;

      const dateStr = $(element).find('td[data-stat="date"]').text().trim();
      const homeTeamName = $(element).find('td[data-stat="home_team"]').text().trim();
      const awayTeamName = $(element).find('td[data-stat="away_team"]').text().trim();
      const scoreStr = $(element).find('td[data-stat="score"]').text().trim();
      const homeXGStr = $(element).find('td[data-stat="home_xg"]').text().trim();
      const awayXGStr = $(element).find('td[data-stat="away_xg"]').text().trim();
      const matchReportCell = $(element).find('td[data-stat="match_report"] a').attr('href');

      // Diagnóstico si la fila está vacía o no jugada
      if (!scoreStr || scoreStr === '' || !matchReportCell) {
        skippedUnplayed++;
        continue;
      }

      const matchId = matchReportCell.split('/')[3] || `${dateStr}-${homeTeamName}`;
      const goals = scoreStr.split(/[–-]/);
      const homeGoals = parseInt(goals[0], 10);
      const awayGoals = parseInt(goals[1], 10);

      const homeXG = homeXGStr ? parseFloat(homeXGStr) : 0.0;
      const awayXG = awayXGStr ? parseFloat(awayXGStr) : 0.0;

      if (isNaN(homeGoals) || isNaN(awayGoals)) continue;

      // Inyección segura en PostgreSQL
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

      await prisma.match.upsert({
        where: { id: matchId },
        update: { homeXG, awayXG },
        create: {
          id: matchId,
          date: new Date(dateStr),
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          homeGoals,
          awayGoals,
          homeXG,
          awayXG,
        },
      });

      insertCount++;
    }

    console.log(`\n=== RESUMEN DE PROCESAMIENTO ===`);
    console.log(`❌ Partidos omitidos (no jugados/sin reporte): ${skippedUnplayed}`);
    console.log(`✅ Partidos guardados con éxito en PostgreSQL: ${insertCount}`);

  } catch (error) {
    console.error('❌ Error durante la ejecución:', error);
  } finally {
    await prisma.$disconnect();
  }
}

scrapeFBrefSeason();