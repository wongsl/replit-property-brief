from rest_framework import serializers
from .models import User, Team, Folder, Tag, Document, DocumentPermission, TeamJoinRequest


class TeamSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Team
        fields = ['id', 'name', 'member_count']


class UserSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source='team.name', read_only=True, default=None)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'role', 'team', 'team_name']


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


class FolderSerializer(serializers.ModelSerializer):
    document_count = serializers.IntegerField(read_only=True, default=0)
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)
    full_path = serializers.CharField(read_only=True)
    children = serializers.SerializerMethodField()

    class Meta:
        model = Folder
        fields = ['id', 'name', 'parent', 'parent_name', 'full_path', 'owner', 'team', 'position', 'created_at', 'document_count', 'children']
        read_only_fields = ['owner']

    def get_children(self, obj):
        if hasattr(obj, '_prefetched_children'):
            children = obj._prefetched_children
        else:
            children = obj.children.all()
        return FolderSerializer(children, many=True).data


class DocumentSerializer(serializers.ModelSerializer):
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    folder_name = serializers.SerializerMethodField()

    def get_folder_name(self, obj):
        if obj.folder:
            return obj.folder.full_path
        return None
    tags = TagSerializer(many=True, read_only=True)
    tag_names = serializers.ListField(child=serializers.CharField(), write_only=True, required=False)

    class Meta:
        model = Document
        fields = [
            'id', 'name', 'file', 'storage_path', 'file_type', 'file_size', 'status',
            'owner', 'owner_name', 'team', 'folder', 'folder_name',
            'tags', 'tag_names', 'position', 'ai_score', 'ai_analysis',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['owner', 'owner_name', 'file_size', 'status']


class TeamJoinRequestSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    team_name = serializers.CharField(source='team.name', read_only=True)

    class Meta:
        model = TeamJoinRequest
        fields = ['id', 'user', 'username', 'team', 'team_name', 'status', 'requested_at', 'resolved_at']
        read_only_fields = ['user', 'username', 'team_name', 'status', 'requested_at', 'resolved_at']
