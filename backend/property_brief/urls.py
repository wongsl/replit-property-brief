from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse

urlpatterns = [
    path('api/health/', lambda req: JsonResponse({'status': 'ok'})),
    path('api/', include('documents.urls')),
]
