import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

// Inicializamos el pool de conexiones nativo de Postgres
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

// Inyectamos el adaptador en el cliente de Prisma
const prisma = new PrismaClient({ adapter });

async function scrapeAndSave() {
  // 1. Simulación de los datos extraídos de Understat
  // En producción, esto vendrá del cheerio y axios que armamos previamente
  const extractedData = {
    matchId: "22235", // ID real de Understat
    date: new Date("2023-10-25T19:00:00Z"),
    homeTeamName: "Arsenal",
    awayTeamName: "Manchester City",
    homeGoals: 1,
    awayGoals: 0,
    homeXG: 1.25,
    awayXG: 0.84
  };

  try {
    // 2. Lógica de Inserción Inteligente (Upsert)
    // "Upsert" significa: Si el equipo no existe, créalo. Si existe, devuélvemelo.
    const homeTeam = await prisma.team.upsert({
      where: { name: extractedData.homeTeamName },
      update: {},
      create: { name: extractedData.homeTeamName },
    });

    const awayTeam = await prisma.team.upsert({
      where: { name: extractedData.awayTeamName },
      update: {},
      create: { name: extractedData.awayTeamName },
    });

    // 3. Guardar el Partido con todas sus métricas
    const match = await prisma.match.upsert({
      where: { id: extractedData.matchId },
      update: {
        homeXG: extractedData.homeXG,
        awayXG: extractedData.awayXG,
      },
      create: {
        id: extractedData.matchId,
        date: extractedData.date,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        homeGoals: extractedData.homeGoals,
        awayGoals: extractedData.awayGoals,
        homeXG: extractedData.homeXG,
        awayXG: extractedData.awayXG,
      },
    });

    console.log(`✅ Partido guardado con éxito en PostgreSQL: ${homeTeam.name} vs ${awayTeam.name}`);
    console.log(`Métricas: xG ${match.homeXG} - ${match.awayXG}`);

  } catch (error) {
    console.error("Error en la base de datos:", error);
  } finally {
    await prisma.$disconnect();
  }
}

scrapeAndSave();