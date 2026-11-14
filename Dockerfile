FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /opt/acha/backend

COPY backend/requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY backend/alembic.ini backend/demo_data.json backend/start.sh ./
COPY backend/app ./app
COPY backend/migrations ./migrations
COPY demo/__init__.py demo/assessment_models.py demo/crew_app.py demo/health_assessment.py demo/mission_demo.json demo/news2.py ../demo/
COPY demo/bidmc_01_Numerics.csv ../demo/

USER 10001:10001

CMD ["sh", "start.sh"]
