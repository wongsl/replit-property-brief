from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    ROLE_CHOICES = [('admin', 'Admin'), ('team_leader', 'Team Leader'), ('user', 'User'), ('viewer', 'Viewer')]
    role = models.CharField(max_length=15, choices=ROLE_CHOICES, default='user')
    team = models.ForeignKey('Team', on_delete=models.SET_NULL, null=True, blank=True, related_name='members')
    email = models.EmailField(unique=True, null=True, blank=True, default=None)

    class Meta:
        db_table = 'users'


class Team(models.Model):
    name = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'teams'


class Folder(models.Model):
    name = models.CharField(max_length=255)
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='children')
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='folders')
    team = models.ForeignKey(Team, on_delete=models.SET_NULL, null=True, blank=True, related_name='folders')
    position = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'folders'
        ordering = ['position', 'name']

    def __str__(self):
        return self.name

    @property
    def full_path(self):
        parts = [self.name]
        current = self.parent
        while current:
            parts.insert(0, current.name)
            current = current.parent
        return ' / '.join(parts)


class Tag(models.Model):
    name = models.CharField(max_length=50, unique=True)

    class Meta:
        db_table = 'tags'

    def __str__(self):
        return self.name


class Document(models.Model):
    TYPE_CHOICES = [('pdf', 'PDF'), ('image', 'Image'), ('code', 'Code'), ('sheet', 'Spreadsheet'), ('other', 'Other')]
    STATUS_CHOICES = [('uploading', 'Uploading'), ('processing', 'Processing'), ('synced', 'Synced'), ('error', 'Error')]

    name = models.CharField(max_length=255)
    file = models.FileField(upload_to='documents/', null=True, blank=True)
    storage_path = models.CharField(max_length=500, null=True, blank=True)
    file_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='other')
    file_size = models.CharField(max_length=20, default='0 KB')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='synced')
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='documents')
    team = models.ForeignKey(Team, on_delete=models.SET_NULL, null=True, blank=True, related_name='documents')
    folder = models.ForeignKey(Folder, on_delete=models.SET_NULL, null=True, blank=True, related_name='documents')
    tags = models.ManyToManyField(Tag, blank=True, related_name='documents')
    position = models.IntegerField(default=0)
    is_private = models.BooleanField(default=False)
    ai_score = models.IntegerField(null=True, blank=True)
    ai_analysis = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'documents'
        ordering = ['position', '-created_at']

    def __str__(self):
        return self.name


class TeamJoinRequest(models.Model):
    STATUS_CHOICES = [('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected')]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='join_requests')
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name='join_requests')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    requested_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'team_join_requests'
        unique_together = [('user', 'team')]

    def __str__(self):
        return f'{self.user.username} → {self.team.name} ({self.status})'


class AdminRequest(models.Model):
    STATUS_CHOICES = [('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected')]
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='admin_request')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    requested_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'admin_requests'

    def __str__(self):
        return f'{self.user.username} admin request ({self.status})'


class DocumentPermission(models.Model):
    PERMISSION_CHOICES = [('view', 'View'), ('edit', 'Edit'), ('admin', 'Admin')]

    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='permissions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='document_permissions', null=True, blank=True)
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name='document_permissions', null=True, blank=True)
    permission = models.CharField(max_length=10, choices=PERMISSION_CHOICES, default='view')

    class Meta:
        db_table = 'document_permissions'
        unique_together = [('document', 'user'), ('document', 'team')]
