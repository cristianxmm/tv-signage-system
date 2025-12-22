const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const PORT = 3000; 

// Aquí guardamos qué se está reproduciendo en cada zona para cuando una TV se reinicia
let estadoActual = {}; 

// LISTA DE USUARIOS (Usuario : Contraseña)
const USUARIOS = {
    "ADMIN": "IT_0Pm**",       
    "LOGISTIC": "Logis_0Pm**", 
    "RH": "Rh2025**",       
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

// --- FUNCIONES DE LIMPIEZA ---
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

// --- MIDDLEWARE DE SEGURIDAD ---
const portero = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
    
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    if (USUARIOS[auth[0]] && USUARIOS[auth[0]] === auth[1]) {
        next(); 
    } else {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
};

// --- CONFIGURACIÓN EXPRESS ---
app.use(express.static('public')); 
app.use('/uploads', express.static('uploads', { maxAge: '30d' })); 
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// --- RUTAS ---
app.post('/api/login', portero, (req, res) => res.json({ status: 'ok' }));
app.get('/admin.html', portero, (req, res) => { res.sendFile(path.join(__dirname, 'public/admin.html')); });

app.post('/publicar', portero, upload.array('archivos', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({error: 'Falta archivo'});
        
        limpiarArchivosMuyViejos(); 
        req.files.forEach(file => borrarVersionesAnteriores(file));

        const target = req.body.target || 'all';
        const autoPlay = req.body.isAuto === 'true'; 
        const durationSec = parseInt(req.body.duration) || 10;
        const primerArchivo = req.files[0];

        // Construir el objeto Payload (el mensaje)
        let payload = {
            target: target,
            options: { autoPlay, duration: durationSec }
        };

        if (primerArchivo.mimetype.includes('video')) {
            payload.type = 'video';
            payload.url = `/uploads/${primerArchivo.filename}`;
        } else {
            payload.type = 'gallery';
            payload.urls = req.files.map(f => `/uploads/${f.filename}`);
        }
        // 1. Guardar en memoria del servidor
        if (target === 'all') {
            // Si es para todos, reseteamos configuraciones individuales para evitar conflictos
            estadoActual = { 'all': payload };
        } else {
            estadoActual[target] = payload;
        }

        // 2. Emitir a las pantallas conectadas
        io.emit('contentUpdate', payload);

        res.json({ status: 'ok' });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error interno' });
    }
});

// --- SOCKET.IO CON PERSISTENCIA ---
io.on('connection', (socket) => { 
    socket.on('join', (room) => {
        socket.join(room);
        console.log(`Pantalla conectada a zona: ${room}`);

        // CUANDO UNA TV SE CONECTA, LE ENVIAMOS LO QUE DEBERÍA ESTAR MOSTRANDO
        // Prioridad 1: Contenido específico para esa sala
        if (estadoActual[room]) {
            socket.emit('contentUpdate', estadoActual[room]);
        } 
        // Prioridad 2: Contenido global ('all')
        else if (estadoActual['all']) {
            socket.emit('contentUpdate', estadoActual['all']);
        }
    });
});

http.listen(PORT, () => console.log(`Sistema Optibelt listo en puerto ${PORT}`));