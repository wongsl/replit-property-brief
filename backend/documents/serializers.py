from rest_framework import serializers
from .models import User, Team, Folder, Tag, Document, DocumentPermission, TeamJoinRequest, AdminRequest, CreditTransaction, CreditRequest, CombinedAnalysis, FeatureFlag


class TeamSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True, default=0)
    document_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Team
        fields = ['id', 'name', 'member_count', 'document_count']


class UserSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source='team.name', read_only=True, default=None)
    document_count = serializers.IntegerField(read_only=True, default=0)
    analyzed_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'role', 'team', 'team_name', 'document_count', 'analyzed_count', 'credits']


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ['id', 'name']


class DocumentPermissionSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True, default=None)
    team_name = serializers.CharField(source='team.name', read_only=True, default=None)

    class Meta:
        model = DocumentPermission
        fields = ['id', 'document', 'user', 'team', 'permission', 'username', 'team_name']


class CombinedAnalysisSerializer(serializers.ModelSerializer):
    source_document_ids = serializers.PrimaryKeyRelatedField(
        source='source_documents', many=True, read_only=True
    )
    source_document_names = serializers.SerializerMethodField()
    is_favorited = serializers.SerializerMethodField()

    def get_source_document_names(self, obj):
        return [{'id': d.id, 'name': d.name} for d in obj.source_documents.all()]

    def get_is_favorited(self, obj):
        if hasattr(obj, 'is_favorited_ann'):
            return obj.is_favorited_ann
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.favorited_by.filter(pk=request.user.pk).exists()
        return False

    class Meta:
        model = CombinedAnalysis
        fields = ['id', 'folder', 'owner', 'source_document_ids', 'source_document_names',
                  'combined_analysis', 'is_favorited', 'created_at']


class CombinedAnalysisSummarySerializer(CombinedAnalysisSerializer):
    """Like CombinedAnalysisSerializer but omits combined_analysis body for folder list responses."""
    class Meta(CombinedAnalysisSerializer.Meta):
        fields = [f for f in CombinedAnalysisSerializer.Meta.fields if f != 'combined_analysis']


class FolderSerializer(serializers.ModelSerializer):
    document_count = serializers.IntegerField(read_only=True, default=0)
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)
    full_path = serializers.CharField(read_only=True)
    children = serializers.SerializerMethodField()
    combined_analyses = CombinedAnalysisSummarySerializer(many=True, read_only=True)
    is_favorited = serializers.SerializerMethodField()

    class Meta:
        model = Folder
        fields = ['id', 'name', 'parent', 'parent_name', 'full_path', 'owner', 'team', 'position', 'created_at', 'document_count', 'children', 'combined_analyses', 'is_favorited', 'is_archived']
        read_only_fields = ['owner']

    def get_children(self, obj):
        children = obj.children.filter(is_archived=False)
        return FolderSerializer(children, many=True, context=self.context).data

    def get_is_favorited(self, obj):
        if hasattr(obj, 'is_favorited_ann'):
            return obj.is_favorited_ann
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.favorited_by.filter(pk=request.user.pk).exists()
        return False


class DocumentSerializer(serializers.ModelSerializer):
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    folder_name = serializers.SerializerMethodField()
    is_favorited = serializers.SerializerMethodField()

    def get_folder_name(self, obj):
        if obj.folder:
            return obj.folder.full_path
        return None

    def get_is_favorited(self, obj):
        if hasattr(obj, 'is_favorited_ann'):
            return obj.is_favorited_ann
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.favorited_by.filter(pk=request.user.pk).exists()
        return False

    tags = TagSerializer(many=True, read_only=True)
    tag_names = serializers.ListField(child=serializers.CharField(), write_only=True, required=False)

    class Meta:
        model = Document
        fields = [
            'id', 'name', 'file', 'storage_path', 'file_type', 'file_size', 'status',
            'owner', 'owner_name', 'team', 'folder', 'folder_name',
            'tags', 'tag_names', 'position', 'is_private', 'is_favorited', 'notes', 'email_draft', 'ai_score', 'ai_analysis',
            'share_token', 'created_at', 'updated_at'
        ]
        read_only_fields = ['owner', 'owner_name', 'file_size', 'status', 'share_token']


class DocumentListSerializer(DocumentSerializer):
    """Like DocumentSerializer but omits ai_analysis for list endpoints (reduces payload size)."""
    class Meta(DocumentSerializer.Meta):
        fields = [f for f in DocumentSerializer.Meta.fields if f != 'ai_analysis']


class AdminDocumentSerializer(serializers.ModelSerializer):
    owner_id = serializers.IntegerField(source='owner.id', read_only=True)
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    team_id = serializers.IntegerField(source='team.id', read_only=True, allow_null=True)
    team_name = serializers.CharField(source='team.name', read_only=True, allow_null=True)
    folder_name = serializers.SerializerMethodField()
    analyzed = serializers.SerializerMethodField()

    def get_folder_name(self, obj):
        return obj.folder.full_path if obj.folder else None

    def get_analyzed(self, obj):
        return obj.ai_analysis is not None

    class Meta:
        model = Document
        fields = [
            'id', 'name', 'file_type', 'file_size', 'status', 'created_at',
            'owner_id', 'owner_name', 'team_id', 'team_name', 'folder_name', 'analyzed',
        ]


class AdminRequestSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.CharField(source='user.email', read_only=True)

    class Meta:
        model = AdminRequest
        fields = ['id', 'user', 'username', 'email', 'status', 'requested_at', 'resolved_at']
        read_only_fields = ['user', 'username', 'email', 'status', 'requested_at', 'resolved_at']


class TeamJoinRequestSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    team_name = serializers.CharField(source='team.name', read_only=True)

    class Meta:
        model = TeamJoinRequest
        fields = ['id', 'user', 'username', 'team', 'team_name', 'status', 'requested_at', 'resolved_at']
        read_only_fields = ['user', 'username', 'team_name', 'status', 'requested_at', 'resolved_at']


class CreditTransactionSerializer(serializers.ModelSerializer):
    document_name = serializers.CharField(source='document.name', read_only=True, default=None)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, default=None)

    class Meta:
        model = CreditTransaction
        fields = ['id', 'type', 'amount', 'document', 'document_name', 'note', 'created_by_name', 'created_at']


class CreditRequestSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = CreditRequest
        fields = ['id', 'user', 'username', 'amount', 'status', 'requested_at', 'resolved_at']
        read_only_fields = ['user', 'username', 'status', 'requested_at', 'resolved_at']


class FeatureFlagSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.CharField(source='updated_by.username', read_only=True, default=None)
    allowed_users_detail = serializers.SerializerMethodField()

    class Meta:
        model = FeatureFlag
        fields = ['key', 'name', 'description', 'enabled', 'allowed_roles', 'allowed_users_detail', 'updated_at', 'updated_by_name']
        read_only_fields = ['key', 'name', 'description', 'updated_at', 'updated_by_name', 'allowed_users_detail']

    def get_allowed_users_detail(self, obj):
        return [{'id': u.id, 'username': u.username} for u in obj.allowed_users.all()]
