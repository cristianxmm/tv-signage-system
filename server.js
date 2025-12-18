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
const PASSWORD = "123"; 

// ⏳ TIEMPO DE VIDA DE ARCHIVOS (30 DÍAS)
// Esto evita que se llene la tarjeta SD de la Raspberry
const DIAS_PARA_BORRAR = 30; 

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/') },
    filename: function (req, file, cb) {
        // Generamos nombre único para evitar que archivos con mismo nombre se reemplacen
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext)
    }
});
const upload = multer({ storage: storage });

// --- FUNCIÓN DE LIMPIEZA AUTOMÁTICA 🧹 ---
// Se ejecuta cada vez que alguien publica algo nuevo
const limpiarArchivosViejos = () => {
    const carpeta = 'uploads/';
    fs.readdir(carpeta, (err, files) => {
        if (err) return console.error("Error leyendo carpeta uploads para limpieza");
        
        files.forEach(file => {
            const rutaCompleta = path.join(carpeta, file);
            fs.stat(rutaCompleta, (err, stats) => {
                if (err) return;
                const ahora = new Date().getTime();
                const fechaArchivo = new Date(stats.birthtime).getTime();
                const diasDeVida = (ahora - fechaArchivo) / (1000 * 3600 * 24);

                if (diasDeVida > DIAS_PARA_BORRAR) {
                    fs.unlink(rutaCompleta, (err) => {
                        if (!err) console.log(`🗑️ Auto-limpieza: Se borró el archivo antiguo ${file}`);
                    });
                }
            });
        });
    });
};

// --- 2. MIDDLEWARE DE SEGURIDAD (PORTERO) ---
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

// --- RUTA DE PUBLICACIÓN OPTIMIZADA ---
app.post('/publicar', portero, upload.array('archivos', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).send('Falta archivo');
        
        limpiarArchivosViejos(); // Ejecutamos la limpieza

        const target = req.body.target || 'all';
        
        // REVISAMOS EL TIPO DE ARCHIVO DEL PRIMER ELEMENTO
        // (Asumimos que si suben varios, todos son del mismo tipo, o son fotos mixtas)
        const primerArchivo = req.files[0];
        const esVideo = primerArchivo.mimetype.includes('video');

        // CASO A: VIDEO (Prioridad: Si hay un video, se muestra solo el video)
        if (esVideo) {
            const filePath = `/uploads/${primerArchivo.filename}`;
            console.log(`🎬 Video enviado a: ${target}`);
            io.emit('contentUpdate', { target, type: 'video', url: filePath });
        }
        
        // CASO B: IMÁGENES (Galería o Imagen sola)
        else {
            const urls = req.files.map(file => `/uploads/${file.filename}`);
            console.log(`📸 Galería de ${urls.length} imágenes a: ${target}`);
            // Enviamos siempre como galería, el frontend decide si pone flechas o no
            io.emit('contentUpdate', { target, type: 'gallery', urls: urls });
        }
        
        res.send({ status: 'ok', message: 'Contenido publicado exitosamente' });

    } catch (e) {
        console.error("Error en publicación:", e);
        res.status(500).send('Error interno del servidor');
    }
});

// CACHÉ Y ESTÁTICOS
app.use(express.static('public')); 
// Configuración de caché para navegadores (30 días)
app.use('/uploads', express.static('uploads', { maxAge: '30d', immutable: true })); 

// Crear carpeta si no existe
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// --- 4. SOCKET ---
io.on('connection', (socket) => {
    console.log('Cliente conectado (Pantalla o Admin)');
    socket.on('join', (room) => socket.join(room));
});

http.listen(PORT, () => {
    console.log(`🚀 Servidor de Pantallas listo en http://localhost:${PORT}`);
});