from rest_framework import viewsets, status, permissions
from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password, check_password
from django.db.models import Count, Q
from .models import Team, Folder, Tag, Document, DocumentPermission, TeamJoinRequest, AdminRequest
from .serializers import (
    UserSerializer, TeamSerializer, FolderSerializer, TagSerializer,
    DocumentSerializer, DocumentPermissionSerializer, TeamJoinRequestSerializer, AdminRequestSerializer
)
from .cache_utils import (
    get_cached, set_cached, _docs_key, _folders_key, _teams_key,
    _user_key, _admin_users_key, invalidate_docs, invalidate_folders,
    invalidate_user, invalidate_teams, invalidate_all_for_user
)

User = get_user_model()


# --- Auth Views ---

@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def register(request):
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '').strip()
    email = request.data.get('email', '').strip().lower()
    role = request.data.get('role', 'user')
    team_id = request.data.get('team_id')

    if not username or not password:
        return Response({'error': 'Username and password required'}, status=400)
    if not email:
        return Response({'error': 'Email is required'}, status=400)

    if User.objects.filter(username=username).exists():
        return Response({'error': 'Username taken'}, status=400)
    if User.objects.filter(email=email).exists():
        return Response({'error': 'An account with this email already exists'}, status=400)

    user = User.objects.create(
        username=username,
        password=make_password(password),
        email=email,
        role=role,
        team_id=team_id,
    )
    request.session['user_id'] = user.id
    invalidate_user(user.id)
    return Response(UserSerializer(user).data, status=201)


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def login(request):
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '').strip()

    try:
        user = User.objects.select_related('team').get(username=username)
    except User.DoesNotExist:
        return Response({'error': 'Invalid credentials'}, status=401)

    if not check_password(password, user.password):
        return Response({'error': 'Invalid credentials'}, status=401)

    request.session['user_id'] = user.id
    set_cached(_user_key(user.id), UserSerializer(user).data)
    return Response(UserSerializer(user).data)


@api_view(['POST'])
def logout(request):
    if request.user and request.user.id:
        invalidate_user(request.user.id)
    request.session.flush()
    return Response({'message': 'Logged out'})


@api_view(['GET'])
def me(request):
    key = _user_key(request.user.id)
    cached = get_cached(key)
    if cached:
        return Response(cached)
    data = UserSerializer(request.user).data
    set_cached(key, data)
    return Response(data)


@api_view(['GET', 'POST'])
@permission_classes([permissions.IsAuthenticatedOrReadOnly])
def teams_list(request):
    if request.method == 'POST':
        if not request.user.is_authenticated or request.user.role != 'admin':
            return Response({'error': 'Admin only'}, status=403)
        name = request.data.get('name', '').strip()
        if not name:
            return Response({'error': 'Team name required'}, status=400)
        if Team.objects.filter(name=name).exists():
            return Response({'error': 'A team with this name already exists'}, status=400)
        team = Team.objects.create(name=name)
        invalidate_teams()
        return Response(TeamSerializer(team).data, status=201)

    key = _teams_key()
    cached = get_cached(key)
    if cached:
        return Response(cached)
    teams = Team.objects.annotate(
        member_count=Count('members', distinct=True),
        document_count=Count('documents', distinct=True),
    )
    data = TeamSerializer(teams, many=True).data
    set_cached(key, data, ttl=600)
    return Response(data)


# --- Folder Views ---

class FolderViewSet(viewsets.ModelViewSet):
    serializer_class = FolderSerializer

    def get_queryset(self):
        qs = Folder.objects.filter(owner=self.request.user).select_related('parent').prefetch_related(
            'children', 'children__children', 'children__children__children'
        ).annotate(
            document_count=Count('documents')
        )
        if self.action == 'list':
            show_all = self.request.query_params.get('all', None)
            if not show_all:
                qs = qs.filter(parent__isnull=True)
        return qs

    def list(self, request, *args, **kwargs):
        key = _folders_key(request.user.id)
        cached = get_cached(key)
        if cached:
            return Response(cached)
        response = super().list(request, *args, **kwargs)
        set_cached(key, response.data)
        return response

    def perform_create(self, serializer):
        parent_id = self.request.data.get('parent')
        parent = None
        if parent_id:
            try:
                parent = Folder.objects.get(id=parent_id, owner=self.request.user)
            except Folder.DoesNotExist:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({'parent': 'Invalid parent folder'})
        serializer.save(owner=self.request.user, team=self.request.user.team, parent=parent)
        invalidate_folders(self.request.user.id)

    def perform_update(self, serializer):
        instance = serializer.instance
        new_parent_id = self.request.data.get('parent')
        if new_parent_id is not None:
            if new_parent_id == '':
                serializer.save(parent=None)
            else:
                new_parent_id = int(new_parent_id)
                if new_parent_id == instance.id:
                    from rest_framework.exceptions import ValidationError
                    raise ValidationError({'parent': 'Cannot move folder into itself'})
                current = Folder.objects.filter(id=new_parent_id, owner=self.request.user).first()
                if not current:
                    from rest_framework.exceptions import ValidationError
                    raise ValidationError({'parent': 'Invalid parent folder'})
                check = current.parent
                while check:
                    if check.id == instance.id:
                        from rest_framework.exceptions import ValidationError
                        raise ValidationError({'parent': 'Cannot move folder into its own descendant'})
                    check = check.parent
                serializer.save(parent=current)
        else:
            serializer.save()
        invalidate_folders(self.request.user.id)

    def perform_destroy(self, instance):
        user_id = self.request.user.id
        team_id = getattr(self.request.user, 'team_id', None)
        instance.delete()
        invalidate_folders(user_id)
        invalidate_docs(user_id, team_id)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        order = request.data.get('order', [])
        for idx, folder_id in enumerate(order):
            Folder.objects.filter(id=folder_id, owner=request.user).update(position=idx)
        invalidate_folders(request.user.id)
        return Response({'status': 'ok'})


# --- Document Views ---

class DocumentViewSet(viewsets.ModelViewSet):
    serializer_class = DocumentSerializer

    def get_queryset(self):
        qs = Document.objects.select_related('owner', 'folder', 'folder__parent', 'folder__parent__parent').prefetch_related('tags')
        scope = self.request.query_params.get('scope', 'mine')
        if scope == 'team' and self.request.user.team:
            qs = qs.filter(team=self.request.user.team, is_private=False)
        else:
            qs = qs.filter(owner=self.request.user)
        return qs

    def list(self, request, *args, **kwargs):
        scope = request.query_params.get('scope', 'mine')
        team_id = getattr(request.user, 'team_id', None)
        key = _docs_key(request.user.id, scope, team_id)
        cached = get_cached(key)
        if cached:
            return Response(cached)
        response = super().list(request, *args, **kwargs)
        set_cached(key, response.data)
        return response

    def _detect_file_type(self, filename):
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        if ext in ('pdf',):
            return 'pdf'
        elif ext in ('png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'):
            return 'image'
        elif ext in ('py', 'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'json'):
            return 'code'
        elif ext in ('xlsx', 'xls', 'csv'):
            return 'sheet'
        return 'other'

    def _format_size(self, size):
        size = int(size) if size else 0
        if size < 1024:
            return f'{size} B'
        elif size < 1024 * 1024:
            return f'{size / 1024:.1f} KB'
        return f'{size / (1024 * 1024):.1f} MB'

    def perform_create(self, serializer):
        storage_path = self.request.data.get('storage_path')
        file_obj = self.request.FILES.get('file')
        name = self.request.data.get('name', '')
        file_size = '0 KB'
        file_type = 'other'

        if storage_path:
            raw_size = self.request.data.get('file_size', 0)
            file_size = self._format_size(raw_size)
            file_type = self._detect_file_type(name)
        elif file_obj:
            file_size = self._format_size(file_obj.size)
            file_type = self._detect_file_type(file_obj.name)

        doc = serializer.save(
            owner=self.request.user,
            team=self.request.user.team,
            file_size=file_size,
            file_type=file_type,
            storage_path=storage_path or '',
            status='synced'
        )

        tag_names = self.request.data.get('tag_names', [])
        if isinstance(tag_names, str):
            tag_names = [tag_names]
        for name in tag_names:
            if isinstance(name, str) and name.strip():
                tag, _ = Tag.objects.get_or_create(name=name.strip().lower())
                doc.tags.add(tag)

        invalidate_docs(self.request.user.id, getattr(self.request.user, 'team_id', None))

    def perform_update(self, serializer):
        if 'team' in serializer.validated_data:
            new_team = serializer.validated_data['team']
            if new_team is not None and self.request.user.role != 'admin':
                if new_team.id != self.request.user.team_id:
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("You can only assign documents to your own team")
        serializer.save()
        invalidate_docs(self.request.user.id, getattr(self.request.user, 'team_id', None))

    def perform_destroy(self, instance):
        user_id = self.request.user.id
        team_id = getattr(self.request.user, 'team_id', None)
        instance.delete()
        invalidate_docs(user_id, team_id)

    @action(detail=True, methods=['post'])
    def add_tag(self, request, pk=None):
        doc = self.get_object()
        name = request.data.get('name', '').strip().lower()
        if not name:
            return Response({'error': 'Tag name required'}, status=400)
        tag, _ = Tag.objects.get_or_create(name=name)
        doc.tags.add(tag)
        invalidate_docs(request.user.id, getattr(request.user, 'team_id', None))
        return Response(DocumentSerializer(doc).data)

    @action(detail=True, methods=['post'])
    def remove_tag(self, request, pk=None):
        doc = self.get_object()
        name = request.data.get('name', '').strip().lower()
        try:
            tag = Tag.objects.get(name=name)
            doc.tags.remove(tag)
        except Tag.DoesNotExist:
            pass
        invalidate_docs(request.user.id, getattr(request.user, 'team_id', None))
        return Response(DocumentSerializer(doc).data)

    @action(detail=True, methods=['post'])
    def analyze(self, request, pk=None):
        doc = self.get_object()
        ai_analysis = request.data.get('ai_analysis')
        ai_score = request.data.get('ai_score')

        if ai_analysis is not None:
            doc.ai_analysis = ai_analysis
        if ai_score is not None:
            doc.ai_score = ai_score
        doc.save(update_fields=['ai_analysis', 'ai_score'])
        invalidate_docs(request.user.id, getattr(request.user, 'team_id', None))
        return Response(DocumentSerializer(doc).data)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        order = request.data.get('order', [])
        for idx, doc_id in enumerate(order):
            Document.objects.filter(id=doc_id, owner=request.user).update(position=idx)
        invalidate_docs(request.user.id, getattr(request.user, 'team_id', None))
        return Response({'status': 'ok'})

    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        doc = self.get_object()
        folder_id = request.data.get('folder_id')
        doc.folder_id = folder_id
        doc.save(update_fields=['folder_id'])
        invalidate_docs(request.user.id, getattr(request.user, 'team_id', None))
        return Response(DocumentSerializer(doc).data)


# --- Permission Views ---

class DocumentPermissionViewSet(viewsets.ModelViewSet):
    serializer_class = DocumentPermissionSerializer

    def get_queryset(self):
        return DocumentPermission.objects.select_related('user', 'team').filter(
            document__owner=self.request.user
        )


# --- Admin views ---

@api_view(['GET'])
def admin_users(request):
    if request.user.role != 'admin':
        return Response({'error': 'Admin only'}, status=403)
    key = _admin_users_key()
    cached = get_cached(key)
    if cached:
        return Response(cached)
    users = User.objects.select_related('team').annotate(
        document_count=Count('documents', distinct=True),
        analyzed_count=Count('documents', filter=Q(documents__ai_analysis__isnull=False), distinct=True),
    ).all()
    data = UserSerializer(users, many=True).data
    set_cached(key, data, ttl=60)
    return Response(data)


@api_view(['PATCH'])
def admin_update_user(request, user_id):
    if request.user.role != 'admin':
        return Response({'error': 'Admin only'}, status=403)
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)

    if 'role' in request.data:
        new_role = request.data['role']
        if new_role not in ('admin', 'team_leader', 'user', 'viewer'):
            return Response({'error': 'Invalid role'}, status=400)
        user.role = new_role
    if 'team_id' in request.data:
        user.team_id = request.data['team_id']
    user.save()
    invalidate_user(user_id)
    return Response(UserSerializer(user).data)


@api_view(['DELETE'])
def admin_delete_user(request, user_id):
    if request.user.role != 'admin':
        return Response({'error': 'Admin only'}, status=403)
    try:
        target_user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)

    if target_user.id == request.user.id:
        return Response({'error': 'Cannot delete yourself'}, status=400)

    keep_files = request.data.get('keep_files', False)
    username = target_user.username

    from django.db import transaction
    with transaction.atomic():
        if keep_files:
            folder, _ = Folder.objects.get_or_create(
                name=username,
                owner=request.user,
                defaults={'team': request.user.team, 'position': 0}
            )
            Document.objects.filter(owner=target_user).update(
                owner=request.user,
                folder=folder,
                team=request.user.team
            )
        target_user.delete()

    invalidate_docs(request.user.id, getattr(request.user, 'team_id', None))
    invalidate_folders(request.user.id)
    invalidate_user(user_id)
    from django.core.cache import cache
    cache.delete(_admin_users_key())
    return Response({'message': f'User {username} deleted'})


# --- Team Join / Leave Views ---

@api_view(['GET', 'POST', 'DELETE'])
def team_join_request(request):
    """Manage the current user's join requests."""
    if request.method == 'GET':
        reqs = TeamJoinRequest.objects.filter(user=request.user, status='pending').select_related('team')
        return Response(TeamJoinRequestSerializer(reqs, many=True).data)

    if request.method == 'DELETE':
        team_id = request.data.get('team_id')
        if not team_id:
            return Response({'error': 'team_id required'}, status=400)
        try:
            req = TeamJoinRequest.objects.get(user=request.user, team_id=team_id, status='pending')
            req.delete()
            return Response({'message': 'Request cancelled'})
        except TeamJoinRequest.DoesNotExist:
            return Response({'error': 'No pending request found for this team'}, status=404)

    # POST — create a new join request
    team_id = request.data.get('team_id')
    if not team_id:
        return Response({'error': 'team_id required'}, status=400)
    if request.user.team_id and request.user.team_id == int(team_id):
        return Response({'error': 'You are already in this team'}, status=400)
    try:
        team = Team.objects.get(pk=team_id)
    except Team.DoesNotExist:
        return Response({'error': 'Team not found'}, status=404)

    req, created = TeamJoinRequest.objects.get_or_create(
        user=request.user, team=team, defaults={'status': 'pending'}
    )
    if not created:
        if req.status == 'pending':
            return Response({'error': 'You already have a pending request for this team'}, status=400)
        # Allow re-requesting if previously rejected
        req.status = 'pending'
        req.resolved_at = None
        req.save()
    return Response(TeamJoinRequestSerializer(req).data, status=201)


@api_view(['GET'])
def team_join_requests_list(request):
    """Team leaders see pending requests for their team; admins see all."""
    if request.user.role not in ('admin', 'team_leader'):
        return Response({'error': 'Team leader or admin only'}, status=403)

    qs = TeamJoinRequest.objects.select_related('user', 'team').filter(status='pending')
    if request.user.role == 'team_leader':
        if not request.user.team_id:
            return Response([])
        qs = qs.filter(team_id=request.user.team_id)
    return Response(TeamJoinRequestSerializer(qs, many=True).data)


@api_view(['POST'])
def team_join_request_resolve(request, request_id):
    """Team leader approves or rejects a join request."""
    if request.user.role not in ('admin', 'team_leader'):
        return Response({'error': 'Team leader or admin only'}, status=403)

    action = request.data.get('action')
    if action not in ('approve', 'reject'):
        return Response({'error': "action must be 'approve' or 'reject'"}, status=400)

    try:
        join_req = TeamJoinRequest.objects.select_related('user', 'team').get(pk=request_id)
    except TeamJoinRequest.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)

    if request.user.role == 'team_leader' and join_req.team_id != request.user.team_id:
        return Response({'error': 'Can only manage join requests for your own team'}, status=403)

    from django.utils import timezone
    join_req.status = 'approved' if action == 'approve' else 'rejected'
    join_req.resolved_at = timezone.now()
    join_req.save()

    if action == 'approve':
        target_user = join_req.user
        target_user.team = join_req.team
        target_user.save()
        invalidate_user(target_user.id)
        invalidate_docs(target_user.id, getattr(target_user, 'team_id', None))

    return Response(TeamJoinRequestSerializer(join_req).data)


@api_view(['POST'])
def team_leave(request):
    """Any authenticated user can leave their current team."""
    if not request.user.team_id:
        return Response({'error': 'You are not in a team'}, status=400)
    request.user.team = None
    request.user.save()
    invalidate_user(request.user.id)
    return Response(UserSerializer(request.user).data)


@api_view(['GET'])
def team_members(request, team_id):
    """List members of a team. Accessible by admins and team leaders of that team."""
    if request.user.role == 'admin':
        pass  # admin can view any team's members
    elif request.user.role == 'team_leader' and request.user.team_id == team_id:
        pass  # team leader can view their own team
    else:
        return Response({'error': 'Not authorized'}, status=403)
    members = User.objects.filter(team_id=team_id).select_related('team')
    return Response(UserSerializer(members, many=True).data)


# --- Admin Application Views ---

@api_view(['GET', 'POST', 'DELETE'])
def admin_apply(request):
    """Any non-admin user can apply for admin role."""
    if request.method == 'GET':
        try:
            req = AdminRequest.objects.get(user=request.user)
            return Response(AdminRequestSerializer(req).data)
        except AdminRequest.DoesNotExist:
            return Response({})

    if request.method == 'DELETE':
        try:
            req = AdminRequest.objects.get(user=request.user, status='pending')
            req.delete()
            return Response({'message': 'Application withdrawn'})
        except AdminRequest.DoesNotExist:
            return Response({'error': 'No pending application'}, status=404)

    # POST — apply for admin
    if request.user.role == 'admin':
        return Response({'error': 'You are already an admin'}, status=400)

    try:
        req = AdminRequest.objects.get(user=request.user)
        if req.status == 'pending':
            return Response({'error': 'You already have a pending application'}, status=400)
        req.status = 'pending'
        req.resolved_at = None
        req.save()
    except AdminRequest.DoesNotExist:
        req = AdminRequest.objects.create(user=request.user)

    return Response(AdminRequestSerializer(req).data, status=201)


@api_view(['GET'])
def admin_applications_list(request):
    """List pending admin applications. Admin only."""
    if request.user.role != 'admin':
        return Response({'error': 'Admin only'}, status=403)
    apps = AdminRequest.objects.filter(status='pending').select_related('user')
    return Response(AdminRequestSerializer(apps, many=True).data)


@api_view(['POST'])
def admin_application_resolve(request, application_id):
    """Approve or reject an admin application. Admin only."""
    if request.user.role != 'admin':
        return Response({'error': 'Admin only'}, status=403)

    action = request.data.get('action')
    if action not in ('approve', 'reject'):
        return Response({'error': "action must be 'approve' or 'reject'"}, status=400)

    try:
        app = AdminRequest.objects.select_related('user').get(pk=application_id)
    except AdminRequest.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)

    from django.utils import timezone
    app.status = 'approved' if action == 'approve' else 'rejected'
    app.resolved_at = timezone.now()
    app.save()

    if action == 'approve':
        app.user.role = 'admin'
        app.user.save()
        invalidate_user(app.user.id)

    return Response(AdminRequestSerializer(app).data)
