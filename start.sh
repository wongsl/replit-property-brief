#!/bin/bash
cd /home/runner/workspace/backend && python manage.py runserver 0.0.0.0:8000 &
DJANGO_PID=$!
cd /home/runner/workspace && npm run dev &
NODE_PID=$!
trap "kill $DJANGO_PID $NODE_PID 2>/dev/null" EXIT
wait
