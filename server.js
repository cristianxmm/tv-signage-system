const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const PORT = 3000; 

// 🔐 LISTA DE USUARIOS (Usuario : Contraseña)
// Puedes agregar cuantos quieras aquí.
const USUARIOS = {
    "ADMIN": "IT_0Pm**",           // El jefe
    "LOGISTIC": "Logis_0Pm**", // Usuario de logística
    "RH": "Rh2025**",       // Usuario de ventas
};

const DIAS_PARA_BORRAR = 30; 

// Configuración de Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/') },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- Limpieza de Versiones Anteriores (Ahorra espacio) ---
const borrarVersionesAnteriores = (archivoNuevo) => {
    const carpeta = 'uploads/';
    const nombreOriginal = archivoNuevo.originalname; 
    const nombreGuardado = archivoNuevo.filename;
    fs.readdir(carpeta, (err, files) => {
        if (err) return;
        files.forEach(file => {
            if (file.endsWith(nombreOriginal) && file !== nombreGuardado) {
                fs.unlink(path.join(carpeta, file), ()=>{});
            }
        });
    });
};

const limpiarArchivosMuyViejos = () => {
    const carpeta = 'uploads/';
    fs.readdir(carpeta, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const ruta = path.join(carpeta, file);
            fs.stat(ruta, (err, s) => {
                if (err) return;
                const dias = (new Date().getTime() - new Date(s.birthtime).getTime()) / (1000 * 3600 * 24);
                if (dias > DIAS_PARA_BORRAR) fs.unlink(ruta, ()=>{});
            });
        });
    });
};

// --- MIDDLEWARE DE SEGURIDAD (MULTI-USUARIO) ---
const portero = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
    
    // Decodificar usuario y contraseña
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const usuarioIngresado = auth[0];
    const passwordIngresado = auth[1];

    // Verificar si el usuario existe y la contraseña coincide
    if (USUARIOS[usuarioIngresado] && USUARIOS[usuarioIngresado] === passwordIngresado) {
        next(); // ¡Pase usted!
    } else {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
};

app.use(express.static('public')); 
app.use('/uploads', express.static('uploads', { maxAge: '30d' })); 
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

app.post('/api/login', portero, (req, res) => res.json({ status: 'ok' }));
app.get('/admin.html', portero, (req, res) => { res.sendFile(path.join(__dirname, 'public/admin.html')); });

// --- RUTA DE PUBLICACIÓN ---
app.post('/publicar', portero, upload.array('archivos', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({error: 'Falta archivo'});
        
        limpiarArchivosMuyViejos(); 
        req.files.forEach(file => borrarVersionesAnteriores(file));

        const target = req.body.target || 'all';
        
        // RECIBIMOS LAS OPCIONES DE SLIDESHOW
        const autoPlay = req.body.isAuto === 'true'; // Convertir string a booleano
        const durationSec = parseInt(req.body.duration) || 10;

        const primerArchivo = req.files[0];
        
        if (primerArchivo.mimetype.includes('video')) {
            const url = `/uploads/${primerArchivo.filename}`;
            io.emit('contentUpdate', { target, type: 'video', url });
        } else {
            const urls = req.files.map(f => `/uploads/${f.filename}`);
            io.emit('contentUpdate', { 
                target, 
                type: 'gallery', 
                urls,
                // Enviamos la configuración a la TV
                options: { autoPlay, duration: durationSec } 
            });
        }
        res.json({ status: 'ok' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error interno' });
    }
});

io.on('connection', (socket) => { socket.on('join', (room) => socket.join(room)); });
http.listen(PORT, () => console.log(`🚀 Sistema Optibelt listo en puerto ${PORT}`));