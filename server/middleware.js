// server/middleware.js
const authManager = require('./auth');

function authenticateSocket(socket, next) {
    const token = socket.handshake.auth.token;

    if (!token) {
        return next(new Error('Authentication required'));
    }

    const decoded = authManager.verifyToken(token);

    if (!decoded) {
        return next(new Error('Invalid token'));
    }

    socket.username = decoded.username;
    next();
}

function authenticateHTTP(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);
    const decoded = authManager.verifyToken(token);

    if (!decoded) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    req.username = decoded.username;
    next();
}

const rateLimitMap = new Map();

function rateLimit(windowMs, max) {
    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();

        if (!rateLimitMap.has(key)) {
            rateLimitMap.set(key, []);
        }

        const requests = rateLimitMap.get(key).filter(time => now - time < windowMs);

        if (requests.length >= max) {
            return res.status(429).json({ error: 'Too many requests' });
        }

        requests.push(now);
        rateLimitMap.set(key, requests);
        next();
    };
}

// Cleanup rate limit map every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, requests] of rateLimitMap.entries()) {
        const validRequests = requests.filter(time => now - time < 600000);
        if (validRequests.length === 0) {
            rateLimitMap.delete(key);
        } else {
            rateLimitMap.set(key, validRequests);
        }
    }
}, 600000);

module.exports = {
    authenticateSocket,
    authenticateHTTP,
    rateLimit
};