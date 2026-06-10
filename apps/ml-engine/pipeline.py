import pandas as pd
from sqlalchemy import create_engine
import matplotlib.pyplot as plt
import torch

def main():
    print("1. Conectando a PostgreSQL...")
    # Usamos la misma URL que configuraste en Prisma
    db_url = 'postgresql://admin:supersecretpassword@localhost:5432/football_data'
    engine = create_engine(db_url)

    # Escribimos una consulta SQL que una la tabla Match con la tabla Team
    # Fíjate en el uso de comillas dobles, Postgres distingue mayúsculas en las columnas que creó Prisma
    query = """
        SELECT m.date, 
               t1.name as home_team, 
               t2.name as away_team, 
               m."homeGoals", m."awayGoals", 
               m."homeXG", m."awayXG",
               m."homePPDA", m."awayPPDA"
        FROM "Match" m
        JOIN "Team" t1 ON m."homeTeamId" = t1.id
        JOIN "Team" t2 ON m."awayTeamId" = t2.id
    """
    
    # Pandas lee directamente de la base de datos y lo convierte en un DataFrame
    df = pd.read_sql(query, engine)
    
    # Rellenamos valores nulos de PPDA con la media o un valor por defecto (ej. 10.0)
    df['homePPDA'] = df['homePPDA'].fillna(df['homePPDA'].mean() if df['homePPDA'].notnull().any() else 10.0)
    df['awayPPDA'] = df['awayPPDA'].fillna(df['awayPPDA'].mean() if df['awayPPDA'].notnull().any() else 10.0)
    
    print("\n--- Datos Extraídos ---")
    print(df)

    # ---------------------------------------------------------
    print("\n2. Generando gráficas exploratorias...")
    # Vamos a graficar el xG del equipo local vs el visitante
    plt.figure(figsize=(8, 6))
    plt.scatter(df['homeXG'], df['awayXG'], color='crimson', s=100, alpha=0.7)
    
    # Añadimos los nombres de los equipos a los puntos del gráfico
    for i, row in df.iterrows():
        plt.annotate(f"{row['home_team']} vs {row['away_team']}", 
                     (row['homeXG'], row['awayXG']),
                     textcoords="offset points", xytext=(0,10), ha='center')

    plt.title('Rendimiento Ofensivo: xG Local vs xG Visitante')
    plt.xlabel('Expected Goals (Local)')
    plt.ylabel('Expected Goals (Visitante)')
    plt.grid(True, linestyle='--', alpha=0.6)
    
    # Guardamos la gráfica en tu disco duro
    plt.savefig('xg_analisis.png')
    print("✅ Gráfica guardada exitosamente como 'xg_analisis.png'.")

    # ---------------------------------------------------------
    print("\n3. Preparando el motor de Deep Learning...")
    # Para el modelo predictivo, aislamos los números. Ahora con 4 dimensiones de features: xG y PPDA
    features = df[['homeXG', 'awayXG', 'homePPDA', 'awayPPDA']].astype(float).values
    targets = df[['homeGoals', 'awayGoals']].astype(float).values

    # Verificamos si tu RTX 4060 está lista para recibir los datos
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Hardware seleccionado para entrenamiento: {device.type.upper()}")

    # Convertimos los arreglos de Pandas a Tensores de PyTorch y los enviamos a la GPU
    X_tensor = torch.tensor(features, dtype=torch.float32).to(device)
    y_tensor = torch.tensor(targets, dtype=torch.float32).to(device)

    print("\n--- Tensores listos en memoria de Video ---")
    print(f"Features (X) Shape: {X_tensor.shape} | Contenido (xG + PPDA):\n{X_tensor}")
    print(f"Targets (y) Shape: {y_tensor.shape} | Contenido:\n{y_tensor}")

if __name__ == "__main__":
    main()