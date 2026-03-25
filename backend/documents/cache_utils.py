from django.core.cache import cache
import logging

logger = logging.getLogger(__name__)

CACHE_TTL = 300

def _docs_key(user_id, scope, team_id=None):
    if scope == 'team' and team_id:
        return f'docs:team:{team_id}'
    return f'docs:{user_id}:mine'

def _folders_key(user_id, archived=False):
    return f'folders:{user_id}:{"archived" if archived else "active"}'

def _teams_key():
    return 'teams:all'

def _user_key(user_id):
    return f'user:{user_id}'

def _admin_users_key():
    return 'admin:users'

def _shared_key(user_id):
    return f'shared:{user_id}'


def get_cached(key):
    data = cache.get(key)
    if data is not None:
        logger.debug(f'Cache HIT: {key}')
    else:
        logger.debug(f'Cache MISS: {key}')
    return data


def set_cached(key, data, ttl=CACHE_TTL):
    cache.set(key, data, ttl)


def invalidate_docs(user_id, team_id=None):
    cache.delete(_docs_key(user_id, 'mine'))
    if team_id:
        cache.delete(_docs_key(user_id, 'team', team_id))


def invalidate_folders(user_id):
    cache.delete(_folders_key(user_id, archived=False))
    cache.delete(_folders_key(user_id, archived=True))


def invalidate_user(user_id):
    cache.delete(_user_key(user_id))
    cache.delete(_admin_users_key())


def invalidate_teams():
    cache.delete(_teams_key())


def invalidate_all_for_user(user_id, team_id=None):
    invalidate_docs(user_id, team_id)
    invalidate_folders(user_id)
    invalidate_user(user_id)
