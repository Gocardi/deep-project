# Blueprint: Deep-Project (Predicción Deportiva)

## Visión General
Sistema de arquitectura híbrida para la ingesta, almacenamiento y procesamiento tensorial de métricas avanzadas de fútbol (xG, PPDA) con el objetivo de entrenar modelos predictivos de Deep Learning.

## Especificaciones de Hardware & Entorno
* **OS:** Windows 11
* **CPU:** Intel i7-12700KF
* **GPU:** NVIDIA RTX 4060 (8GB VRAM)
* **Aceleración:** CUDA 12.1 habilitado para PyTorch
* **Contenedores:** Docker Desktop activo para bases de datos

---

## Estructura del Monorepositorio

```text
deep-project/
├── apps/
│   ├── scraper/                # Extracción de datos de la web
│   │   ├── prisma/             # Esquema de BD y migraciones
│   │   ├── prisma.config.ts    # Configuración de Prisma v7+
│   │   └── index.ts            # Lógica de scraping y guardado
│   ├── ml-engine/              # Motor de Inteligencia Artificial
│   │   ├── .venv/              # Entorno virtual de Python
│   │   ├── pipeline.py         # Conexión DB, gráficas y tensores
│   │   └── modelos/            # (Futuro) Scripts de entrenamiento
│   ├── api-backend/            # (Futuro) Backend NestJS
│   └── frontend/               # (Futuro) Dashboard Next.js
├── data/
│   └── raw/                    # Data Lake: JSONs masivos (Ignorado en Git)
├── docker-compose.yml          # Configuración del contenedor PostgreSQL
├── ARQUITECTURA.md             # Este documento
└── .gitignore                  # Exclusión de módulos, venvs y data cruda

graph TD
    subgraph Fuentes de Datos
        A[Webs: Understat / FBref]
        B[GitHub: StatsBomb JSON]
    end

    subgraph apps/scraper TypeScript
        C[Motor de Extracción TS]
        D[Data Lake Local data/raw]
        C -->|Scraping Axios/Cheerio| A
        B -->|Descarga| D
        D -.->|Lectura| C
    end

    subgraph Base de Datos Local
        E[(PostgreSQL - Docker)]
        C -->|Escritura - Prisma ORM| E
    end

    subgraph apps/ml-engine Python
        F[Data Pipeline - Pandas/SQLAlchemy]
        G[Entrenamiento GPU - PyTorch/CUDA]
        H[Exploración Visual - Matplotlib]
        E -->|Lectura SQL| F
        F -->|Tensores Multidimensionales| G
        F -->|DataFrames| H
    end

    subgraph apps/api-backend & frontend Planeado
        I[API Orquestadora - NestJS]
        J[Dashboard Predictivo - Next.js]
        E -->|Consumo Prisma| I
        G -.->|Exportación de Pesos .pt| I
        I -->|Endpoints| J
    end