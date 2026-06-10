import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

import axios from 'axios';

async function processStatsBombData() {
  const baseDir = 'c:/Trabajo/deep-project/data/raw/statsbomb';
  const matchesDir = path.join(baseDir, 'matches');
  const eventsDir = path.join(baseDir, 'events');

  // Asegurar directorios
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  if (!fs.existsSync(matchesDir)) fs.mkdirSync(matchesDir, { recursive: true });
  if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });

  // Si no hay archivos de partidos, descargamos un juego de prueba (LaLiga 20/21) de StatsBomb GitHub
  const sampleMatches = fs.readdirSync(matchesDir).filter(f => f.endsWith('.json'));
  if (sampleMatches.length === 0) {
    console.log('📥 No se encontraron datos locales. Descargando muestras de prueba desde el GitHub oficial de StatsBomb...');
    try {
      // Descargar metadatos del partido (La Liga 20/21, id partido: 3773369)
      const matchUrl = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data/matches/11/90.json';
      const matchRes = await axios.get(matchUrl);
      fs.writeFileSync(path.join(matchesDir, '90.json'), JSON.stringify(matchRes.data, null, 2));
      console.log('✅ Partidos de muestra descargados (90.json).');

      // Descargar los eventos de ese partido específico (contiene el xG detallado)
      console.log('📥 Descargando eventos de muestra para calcular el xG...');
      const eventUrl = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data/events/3773369.json';
      const eventRes = await axios.get(eventUrl);
      fs.writeFileSync(path.join(eventsDir, '3773369.json'), JSON.stringify(eventRes.data, null, 2));
      console.log('✅ Eventos de muestra descargados (3773369.json).');
    } catch (downloadErr) {
      console.error('❌ Error descargando muestras de StatsBomb:', downloadErr.message);
      return;
    }
  }

  try {
    const files = fs.readdirSync(matchesDir).filter(f => f.endsWith('.json'));
    console.log(`📂 Archivos JSON de partidos detectados: ${files.length}`);

    let insertCount = 0;

    for (const file of files) {
      const filePath = path.join(matchesDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const matches = JSON.parse(content);

      if (!Array.isArray(matches)) continue;

      for (const match of matches) {
        const matchId = match.match_id.toString();
        const dateStr = match.match_date;
        const homeTeamName = match.home_team.home_team_name;
        const awayTeamName = match.away_team.away_team_name;
        const homeGoals = match.home_score;
        const awayGoals = match.away_score;

        // Calculamos xG desde los archivos de eventos si existen
        let homeXG = 0.0;
        let awayXG = 0.0;

        const eventFilePath = path.join(eventsDir, `${matchId}.json`);
        if (fs.existsSync(eventFilePath)) {
          const eventContent = fs.readFileSync(eventFilePath, 'utf-8');
          const events = JSON.parse(eventContent);
          
          if (Array.isArray(events)) {
            for (const event of events) {
              if (event.type?.name === 'Shot' && event.shot?.statsbomb_xg) {
                const teamName = event.team?.name;
                const xGVal = parseFloat(event.shot.statsbomb_xg) || 0.0;
                
                if (teamName === homeTeamName) {
                  homeXG += xGVal;
                } else if (teamName === awayTeamName) {
                  awayXG += xGVal;
                }
              }
            }
          }
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

        // Upsert del partido
        await prisma.match.upsert({
          where: { id: `statsbomb-${matchId}` },
          update: {
            homeGoals,
            awayGoals,
            homeXG: parseFloat(homeXG.toFixed(2)),
            awayXG: parseFloat(awayXG.toFixed(2)),
          },
          create: {
            id: `statsbomb-${matchId}`,
            date: new Date(dateStr),
            homeTeamId: homeTeam.id,
            awayTeamId: awayTeam.id,
            homeGoals,
            awayGoals,
            homeXG: parseFloat(homeXG.toFixed(2)),
            awayXG: parseFloat(awayXG.toFixed(2)),
          },
        });

        insertCount++;
      }
    }

    console.log(`\n=== RESUMEN DE PROCESAMIENTO STATSBOMB ===`);
    console.log(`✅ Partidos cargados/actualizados de StatsBomb: ${insertCount}`);

  } catch (error) {
    console.error('❌ Error al procesar los archivos de StatsBomb:', error);
  } finally {
    await prisma.$disconnect();
  }
}

processStatsBombData();
