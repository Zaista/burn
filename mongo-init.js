db = db.getSiblingDB('postit');

db.createUser({
    user: 'appuser',
    pwd: 'apppass',
    roles: [
        {
            role: 'readWrite',
            db: 'postit'
        }
    ]
});