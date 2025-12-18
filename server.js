const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// --- 1. CONFIGURACIÓN ---
const PORT = 3000; 

// 🔐 CREDENCIALES
const USUARIO = "admin";
const PASSWORD = "123"; // ¡Cámbialo antes de producción!

// TIEMPO DE VIDA GENERAL (30 DÍAS)
// Red de seguridad por si quedan archivos huérfanos que nadie borró
const DIAS_PARA_BORRAR = 30; 

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/') },
    filename: function (req, file, cb) {
        // Ponemos el timestamp AL INICIO para asegurar unicidad
        // Ej: 17150099-menu.jpg
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- BORRAR DUPLICADOS ANTERIORES ---
// Esta es la que ahorra espacio en el servidor al instante
const borrarVersionesAnteriores = (archivoNuevo) => {
    const carpeta = 'uploads/';
    const nombreOriginal = archivoNuevo.originalname; 
    const nombreGuardado = archivoNuevo.filename;

    fs.readdir(carpeta, (err, files) => {
        if (err) return;
        files.forEach(file => {
            // Buscamos archivos que terminen con el mismo nombre original
            // Ej: Si subes "video.mp4", borra "1234-video.mp4" y "5678-video.mp4"
            if (file.endsWith(nombreOriginal) && file !== nombreGuardado) {
                const rutaVieja = path.join(carpeta, file);
                fs.unlink(rutaVieja, (err) => {
                    if (!err) console.log(`♻️  Espacio liberado: Se borró versión vieja de ${nombreOriginal}`);
                });
            }
        });
    });
};

// Limpieza general de basura antigua (por si acaso)
const limpiarArchivosMuyViejos = () => {
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

// --- 2. SEGURIDAD ---
const portero = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    if (auth[0] === USUARIO && auth[1] === PASSWORD) next(); 
    else return res.status(401).json({ error: 'Credenciales incorrectas' });
};

// --- 3. RUTAS Y CACHÉ ---
app.use(express.static('public')); 

//CACHÉ ACTIVADO (30 DÍAS): Vital para que el video no se corte si falla el WiFi.
// No afecta la actualización porque cada archivo nuevo tiene nombre distinto.
app.use('/uploads', express.static('uploads', { maxAge: '30d' })); 

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Login para el HTML del panel admin
app.post('/api/login', portero, (req, res) => res.json({ status: 'ok' }));

// Admin Panel
app.get('/admin.html', portero, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// --- RUTA DE PUBLICACIÓN MAESTRA ---
app.post('/publicar', portero, upload.array('archivos', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({error: 'Falta archivo'});
        
        limpiarArchivosMuyViejos(); 
        
        // Ejecutamos la limpieza inteligente archivo por archivo
        req.files.forEach(file => {
            borrarVersionesAnteriores(file);
        });

        const target = req.body.target || 'all';
        const primerArchivo = req.files[0];
        
        // Lógica de Video vs Galería
        if (primerArchivo.mimetype.includes('video')) {
            const url = `/uploads/${primerArchivo.filename}`;
            console.log(`🎬 Video nuevo: ${url}`);
            io.emit('contentUpdate', { target, type: 'video', url });
        } else {
            const urls = req.files.map(f => `/uploads/${f.filename}`);
            console.log(`📸 Galería nueva: ${urls.length} fotos`);
            io.emit('contentUpdate', { target, type: 'gallery', urls });
        }
        res.json({ status: 'ok' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error interno' });
    }
});

// --- 4. SOCKET ---
io.on('connection', (socket) => { 
    console.log('Cliente conectado');
    socket.on('join', (room) => socket.join(room)); 
});

http.listen(PORT, () => console.log(`🚀 Sistema listo en puerto ${PORT}`));