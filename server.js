const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN ---
const PORT = 3000; 
const USUARIO = "admin";
const PASSWORD = "123"; // ⚠️ ¡CAMBIAR ESTO POR ALGO SEGURO!
const DIAS_PARA_BORRAR = 30; 

// Configuración de Multer (Subida de archivos)
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/') },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext)
    }
});
const upload = multer({ storage: storage });

// Función de limpieza (igual que antes)
const limpiarArchivosViejos = () => {
    const carpeta = 'uploads/';
    fs.readdir(carpeta, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const rutaCompleta = path.join(carpeta, file);
            fs.stat(rutaCompleta, (err, stats) => {
                if (err) return;
                const dias = (new Date().getTime() - new Date(stats.birthtime).getTime()) / (1000 * 3600 * 24);
                if (dias > DIAS_PARA_BORRAR) fs.unlink(rutaCompleta, ()=>{});
            });
        });
    });
};

// --- SEGURIDAD: PORTERO MODERNO ---
// Ya no lanza la ventana emergente del navegador.
const portero = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    // Si no hay cabecera o la contraseña está mal
    if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
    
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    if (auth[0] === USUARIO && auth[1] === PASSWORD) {
        next(); 
    } else {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
};

// --- RUTAS ---

app.use(express.static('public')); 
app.use('/uploads', express.static('uploads', { maxAge: '30d' }));
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Ruta especial para validar login sin subir archivos
app.post('/api/login', portero, (req, res) => {
    res.json({ status: 'ok', message: 'Bienvenido' });
});

// Ruta de publicación (Protegida)
app.post('/publicar', portero, upload.array('archivos', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({error: 'Falta archivo'});
        limpiarArchivosViejos();
        
        const target = req.body.target || 'all';
        const primerArchivo = req.files[0];
        
        if (primerArchivo.mimetype.includes('video')) {
            const url = `/uploads/${primerArchivo.filename}`;
            io.emit('contentUpdate', { target, type: 'video', url });
        } else {
            const urls = req.files.map(f => `/uploads/${f.filename}`);
            io.emit('contentUpdate', { target, type: 'gallery', urls });
        }
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ error: 'Error interno' });
    }
});

io.on('connection', (socket) => { socket.on('join', (room) => socket.join(room)); });

http.listen(PORT, () => console.log(`🚀 Listo en http://localhost:${PORT}/admin.html`));