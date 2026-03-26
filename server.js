require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = 'playlist.json';

// --- USUARIOS Y CONTRASEÑAS ---
const USUARIOS = {
    "IT":         { pass: process.env.PASS_IT,    folder: 'It' },
    "PRODUCTION": { pass: process.env.PASS_PROD,  folder: 'Production' },
    "RH":         { pass: process.env.PASS_RH,    folder: 'Rh' },
    "LOGISTIC":   { pass: process.env.PASS_LOG,   folder: 'Logistic' },
    "EHS":        { pass: process.env.PASS_EHS,   folder: 'Ehs' },
    "QUALITY":    { pass: process.env.PASS_QUAL,  folder: 'Quality' },
};

// Cargar playlists guardadas
let playlists = {};
if (fs.existsSync(DATA_FILE)) {
    try { 
        playlists = JSON.parse(fs.readFileSync(DATA_FILE)); 
    } catch(e){ 
        console.error("Error leyendo JSON", e); 
    }
}

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Crear carpetas si no existen
Object.values(USUARIOS).forEach(u => {
    const p = path.join('uploads', u.folder);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// --- MIDDLEWARE DE SEGURIDAD ---
const portero = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No auth' });
    
    try {
        const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
        const user = auth[0];
        const pass = auth[1];

        if (USUARIOS[user] && USUARIOS[user].pass === pass) {
            req.userFolder = USUARIOS[user].folder;
            req.userName = user;
            next(); 
        } else { 
            return res.status(401).json({ error: 'Credenciales Incorrectas' }); 
        }
    } catch (e) {
        return res.status(401).json({ error: 'Error de autenticación' });
    }
};

// Configuración de Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const p = path.join(__dirname, 'uploads', req.userFolder);
        cb(null, p);
    },
    filename: (req, file, cb) => {
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, cleanName);
    }
});

// --- CORRECCIÓN 1: FILTRO DE ARCHIVOS MÁS ESTRICTO ---
// Eliminamos .mov y .mkv para asegurar que el navegador pueda reproducirlo
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 
        'video/mp4', 'video/webm' // Solo formatos 100% web safe
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Formato no válido. Sube solo MP4 o Imágenes (JPG/PNG)'), false);
    }
};

function getAllFiles() {
    let allFiles = [];
    Object.values(USUARIOS).forEach(u => {
        const dir = path.join(__dirname, 'uploads', u.folder);
        if(fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            files.forEach(f => {
                // Filtramos también aquí para la vista del administrador
                if(f.match(/\.(jpg|jpeg|png|gif|mp4|webm)$/i)) {
                    allFiles.push({
                        url: `/uploads/${u.folder}/${f}`,
                        owner: u.folder, 
                        name: f,
                        type: f.match(/\.(mp4|webm)$/i) ? 'video' : 'image'
                    });
                }
            });
        }
    });
    return allFiles;
}

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 500 * 1024 * 1024 }
});

// --- RUTAS ---

app.post('/api/login', portero, (req, res) => {
    res.json({ status: 'ok', folder: req.userFolder });
});

app.post('/upload', portero, upload.array('files'), (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/admin-content', portero, (req, res) => {
    const tvId = req.query.tvId || 'default';
    const config = playlists[tvId] || { activeImages: [], activeVideos: [], interval: 10000, isAuto: false };
    const files = getAllFiles();
    res.json({ allFiles: files, config: config, currentUserFolder: req.userFolder });
});

app.post('/api/save-config', portero, (req, res) => {
    const tvId = req.body.tvId || 'default';
    const myFolder = req.userFolder;
    
    let currentPlaylist = playlists[tvId] || { activeImages: [], activeVideos: [], interval: 10000, isAuto: false };
    
    const mergeLists = (currentList, newItems) => {
        const safeCurrent = currentList || [];
        const safeNew = newItems || [];
        const others = safeCurrent.filter(url => !url.includes(`/uploads/${myFolder}/`));
        const combined = [...others, ...safeNew];
        return [...new Set(combined)];
    };

    playlists[tvId] = {
        activeImages: mergeLists(currentPlaylist.activeImages, req.body.activeImages),
        activeVideos: mergeLists(currentPlaylist.activeVideos, req.body.activeVideos),
        interval: parseInt(req.body.interval) || 10000,
        isAuto: req.body.isAuto === true
    };
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(playlists, null, 2));
    io.emit('refresh_' + tvId); 
    res.json({ status: 'ok' });
});
// --- NUEVA RUTA: ELIMINAR ARCHIVO ---
app.post('/api/delete-file', portero, (req, res) => {
    const fileUrl = req.body.url; 
    
    // Seguridad: Verificamos que el archivo pertenezca a la carpeta del usuario actual
    if (!fileUrl || !fileUrl.includes(`/uploads/${req.userFolder}/`)) {
        return res.status(403).json({ error: 'No tienes permiso para borrar este archivo' });
    }

    try {
        const relativePath = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
        const fullPath = path.join(__dirname, relativePath);
        
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath); // Elimina el archivo físicamente de la SD
            res.json({ status: 'ok' });
        } else {
            res.status(404).json({ error: 'Archivo no encontrado en disco' });
        }
    } catch (e) {
        console.error("Error al borrar:", e);
        res.status(500).json({ error: 'Error del servidor al borrar' });
    }
});
// --- CORRECCIÓN 2: RUTA TV CONTENT BLINDADA ---
app.get('/api/tv-content', (req, res) => {
    const tvId = req.query.tvId || 'default';
    // Copiamos el objeto para no modificar la referencia original en memoria
    let playlist = JSON.parse(JSON.stringify(playlists[tvId] || { activeImages: [], activeVideos: [], interval: 10000, isAuto: true }));

    // HELPER: Verifica que el archivo exista en disco antes de enviarlo
    const checkFileExists = (url) => {
        try {
            // url viene como '/uploads/It/foto.jpg', quitamos el primer '/' para que path.join funcione bien
            const relativePath = url.startsWith('/') ? url.substring(1) : url; 
            const fullPath = path.join(__dirname, relativePath);
            return fs.existsSync(fullPath);
        } catch (err) {
            return false;
        }
    };

    // Filtramos los arrays: Si el archivo no existe en disco, se quita de la lista que recibe la TV
    if (playlist.activeImages) {
        playlist.activeImages = playlist.activeImages.filter(checkFileExists);
    }
    if (playlist.activeVideos) {
        playlist.activeVideos = playlist.activeVideos.filter(checkFileExists);
    }

    res.json(playlist);
});

io.on('connection', socket => console.log("TV Conectada"));

http.listen(PORT, () => console.log(`Servidor Optibelt LISTO en puerto ${PORT}. Version 3.1`));