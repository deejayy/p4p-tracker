#!/usr/bin/node

var fs = require('fs');
var net = require('net');

var options = {
	timeout: 60*3, // default announce update timeout (seconds)
	port: 2710,
}

var masks = {}
var peers = {};
var files = {};
var debugging = 1;

fs.readFileSync('./masks.txt').toString('UTF-8').split(/\r?\n/).map(function (e, i) {
	if (e.trim()) {
		masks[e] = {};
	}
});

var server = net.createServer(function (socket) {
	var connection = new conn(socket);
}).listen(options.port, function () {
	console.log('Server started on port: ' + options.port);
});

function debug(data) {
	if (debugging) {
		console.log(new Date());
		console.log(data);
	}
}

function ip2int(ip) {
	var ipint = 0;
	ip.split('.').map(function (e, i) {
		ipint += Math.pow(256, 3-i) * e;
    });
    return ipint;
}

function peer(peer_id, ip, port)
{
	this.peer_id = peer_id;
	this._ip = ip;
	this.port = port;
	this.hashes = {};
	this.ipint = ip2int(ip);
	this.closeTimer = setTimeout(this.close.bind(this), options.timeout*1000);
}

peer.prototype = {
	set ip(ip) {
		this._ip = ip;
		this.ipint = ip2int(ip);
	},

	get ip() {
		return this._ip;
	},

	restart: function (mypeer) {
		clearTimeout(mypeer.closeTimer);
		mypeer.closeTimer = setTimeout(mypeer.close.bind(mypeer), options.timeout*1000);
	},

	close: function () {
		debug('Peer timeout: ' + this.peer_id);
		clearTimeout(this.closeTimer);
		delete peers[this.peer_id];
		for (h in this.hashes) {
			delete files[h].peers[this.peer_id];
		}
	},
}

function conn(socket)
{
	this.socket = socket;
	this.ip = this.socket.remoteAddress;
	socket.on('data', this.getData.bind(this)).setEncoding('binary');
}

function getpeerlist(info_hash, peer_id) {
	var peerlist = new Buffer(Object.keys(files[info_hash]['peers']).length*6);
	var peerlistfull = new Buffer(Object.keys(files[info_hash]['peers']).length*6);

	var servedpeernum = 0;
	var localmasks = {};

	for (m in masks) {
		if (masks[m].check(peers[peer_id]['ipint'])) {
			localmasks[m] = 1;
		}
	}

	if (!Object.keys(localmasks).length) {
		debug('Not in any known subnet');
		localmasks = masks;
	}

	Object.keys(files[info_hash]['peers']).map(function (e, i) {
		for (m in localmasks) {
			if (masks[m].check(peers[e]['ipint'])) {
				debug('Serving out peer at ' + peers[e]['ip'] + ':' + peers[e]['port'] + ' (' + peers[e]['ipint'] + ')');
				peerlist.writeUInt32BE(peers[e]['ipint'], servedpeernum*6);
				peerlist.writeUInt16BE(peers[e]['port'],  servedpeernum*6+4);
				servedpeernum++;
			}
		}
		peerlistfull.writeUInt32BE(peers[e]['ipint'], i*6);
		peerlistfull.writeUInt16BE(peers[e]['port'],  i*6+4);
	});

	if (servedpeernum) {
		return peerlist.slice(0, servedpeernum*6);
	} else {
		return peerlistfull;
	}

}

conn.prototype = {
	getData: function (data) {
		debug('Received request from ' + this.ip);
		if (r = data.toString('UTF-8').match(/^GET \/announce?\?(.*) HTTP\/1\..*/)) {
			var req = {};
			r[1].split(/\&/).map(function (e, i) {
				var param = e.match(/(.*?)=(.*)/);
				req[param[1]] = unescape(param[2]);
			});

			debug(req);

			if (req['ip']) {
				this.ip = req['ip'];
			}
			peers[req['peer_id']]   = peers[req['peer_id']]   ? peers[req['peer_id']]   : new peer (req['peer_id'], this.ip, req['port'] * 1);
			files[req['info_hash']] = files[req['info_hash']] ? files[req['info_hash']] : { info_hash: req['info_hash'], peers: {}, downloaded: 0, complete: 0, incomplete: 0 };
			files[req['info_hash']]['downloaded'] += req['event'] == 'completed' ? 1 : 0;
			files[req['info_hash']]['peers'][req['peer_id']] = peers[req['peer_id']]['hashes'][req['info_hash']] = (req['event'] == 'completed' || req['left'] == 0 ? '' : 'in') + 'complete';

			Object.keys(files[req['info_hash']]['peers']).map(function (e, i) {
				files[req['info_hash']][(files[req['info_hash']]['peers'][e] != 'complete' ? 'in' : '') + 'complete']++;
			});

			var peerlist = getpeerlist(req['info_hash'], req['peer_id']);
			debug(peerlist);

			peers[req['peer_id']].restart(peers[req['peer_id']]);
			this.socket.write('HTTP/1.0 200 OK\r\n\r\nd8:completei' + files[req['info_hash']]['complete'] + 'e10:downloadedi' + files[req['info_hash']]['downloaded'] + 'e10:incompletei' + files[req['info_hash']]['incomplete'] + 'e8:intervali' + options.timeout + 'e12:min intervali60e5:peers' + peerlist.length + ':' + peerlist.toString('binary') + 'e', 'binary');
		}
		this.socket.end();
	},
}

for (m in masks) {
	maskhelper = m.split('/');

	masks[m].maskmin = ip2int(maskhelper[0]);
	masks[m].maskmax = masks[m].maskmin + Math.pow(2, 32-maskhelper[1]) - 1;
	masks[m].check = function (ip) {
		return ip >= this.maskmin && ip <= this.maskmax;
	}
}

debug(masks);

process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function(data) {
	if (data.trim() == 's') {
		console.log('\npeers:\n');
		console.log(peers);
		console.log('\nfiles:\n');
		console.log(files);
		console.log('\n');
	}
	if (data.trim() == 'd') {
		debugging = 1 - debugging;
		console.log('Debugging o' + (debugging ? 'n' : 'ff'));
	}
	if (data.trim() == 'c') {
		for (p in peers) {
			peers[p].close();
		}
		files = {};
	}
	if (data.trim() == 'q') {
		process.exit();
	}
});
