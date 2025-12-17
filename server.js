const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// --- 1. PORT ---
const PORT = 3000; 

// 🔐 CREDENCIALES
const USUARIO = "admin";
const PASSWORD = "123"; 

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/') },
    filename: function (req, file, cb) {
        // El nombre cambia con la fecha
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext)
    }
});
const upload = multer({ storage: storage });

// --- 2. MIDDLEWARE DE SEGURIDAD ---
const portero = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).send('🔒 Acceso Denegado');
    }
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    if (auth[0] === USUARIO && auth[1] === PASSWORD) {
        next(); 
    } else {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).send('❌ Contraseña incorrecta');
    }
};

// --- 3. RUTAS ---

// Panel Admin Protegido
app.get('/admin.html', portero, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// Subida de Archivos Protegida
app.post('/publicar', portero, upload.single('archivo'), (req, res) => {
    try {
        if (!req.file) return res.status(400).send('Falta archivo');
        
        const target = req.body.target || 'all';
        const mime = req.file.mimetype;
        const filePath = `/uploads/${req.file.filename}`;

        console.log(`📡 Enviando a: ${target}`);

        if (req.file.originalname.endsWith('.xlsx') || mime.includes('spreadsheet')) {
            const wb = xlsx.readFile(req.file.path);
            const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            io.emit('contentUpdate', { target, type: 'table', data: data });
        } 
        else if (mime.includes('image')) {
            io.emit('contentUpdate', { target, type: 'image', url: filePath });
        }
        else if (mime.includes('video')) {
            io.emit('contentUpdate', { target, type: 'video', url: filePath });
        }
        
        res.send({ status: 'ok', message: 'Enviado' });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error');
    }
});

app.use(express.static('public')); 

// immutable: true -> Le dice a la TV "Este archivo no va a cambiar, confía en mí".
app.use('/uploads', express.static('uploads', { 
    maxAge: '30d', 
    immutable: true 
})); 

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// --- 4. SOCKET ---
io.on('connection', (socket) => {
    socket.on('join', (room) => socket.join(room));
});

http.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});