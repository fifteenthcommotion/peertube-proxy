#!/usr/bin/node

const http = require('http');
const request = require('request');
const webtorrent = require('webtorrent');
const fs = require('fs');
const address = '127.0.0.1';
const port = 8283;

const validator_re = new RegExp('^(https://?)?[a-zA-Z-\.]+/videos/watch/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
const uuid_re = new RegExp('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
const domain_re = new RegExp('[a-zA-Z-\.]+(?=/videos/watch/)');

const topts = {
	'maxWebConns': 16,
};
const torrent_file_path = 'torrents';
const video_file_path = 'videos';

// TODO torrent path to something persistent AND deduplicated based on infohash
// https://github.com/webtorrent/webtorrent/issues/200

var tclient = new webtorrent();
var torrents = {}; // (our_id) -> torrent object

fs.readdir(torrent_file_path, function(err, files) {
	files.forEach(function(file) {
		var full_fn = torrent_file_path + '/' + file;
		var our_id = file;
		var topts_real = Object.assign({'path': video_file_path + '/' + our_id}, topts);
		torrents[our_id] = tclient.add(full_fn, topts_real, function(t){console.log('[Startup] Added file', full_fn, 'as torrent for video', our_id);});
	});
});


function error_404(res) {
	res.writeHeader(404, {'Content-Type': 'text/plain'});
	res.end('404 not found\n');
}

function handler (req, res) {

	function handler_part2(torrent) {
		var file = torrent.files[0];
		var stream = file.createReadStream();
		console.log('Serving video:', our_id);
		res.writeHeader(200, {'Content-Type': 'application/octet-stream', 'Content-Length': file.length});
		//res.writeHeader(200, {'Content-Type': 'video/mp4', 'Content-Length': file.length});
		stream.pipe(res);
	}

	function save_and_continue(torrent) {
		var filename = torrent_file_path + '/' + our_id;
		fs.writeFile(filename, torrent.torrentFile, function(err) {if (err) {
			console.error('Unable to save torrent file', filename, 'for video', our_id, ':', err);} else {
			console.log('Saved torrent file', filename, 'for video', our_id);}
		});
		handler_part2(torrent);
	}

	function meta_helper(err, client_res, body) {
		if (err || (client_res.statusCode != 200)) {
			error_404(res);
		} else {
			var meta = JSON.parse(body);
			//console.log(meta);
			var resolutions = meta['files'].map(function (elem) {return [elem.resolution.id, elem.torrentDownloadUrl];});
			//console.log(resolutions);
			var max_res = 0;
			var best_url = '';
			for (var i = 0; i < resolutions.length; i++) {
				var r = resolutions[i];
				//console.log(r[0], '?>', r[1]);
				if (r[0] > max_res) {
					max_res = r[0];
					best_url = r[1];
				}
			}
			console.log('Adding url', best_url, 'of quality', max_res);
			var topts_real = Object.assign({'path': video_file_path + '/' + our_id}, topts);
			torrents[our_id] = tclient.add(best_url, topts_real, save_and_continue);
		}
	}

	var pturl = req.url.slice(1); // all except first character
	if (pturl == 'stats') {
		res.writeHeader(200, {'Content-Type': 'text/plain'});
		res.write('Total Ratio: ' + tclient.ratio + '\n');
		Object.keys(torrents).forEach(function(our_id) {
			var t = torrents[our_id];
			res.write('Video ' + our_id + ' (' + t.infoHash + ')\n');
			res.write('\tMagnet: ' + t.magnetURI + '\n');
			res.write('\tDownloaded: ' + t.downloaded + '\n');
			res.write('\tUploaded: ' + t.uploaded + '\n');
			res.write('\tRatio: ' + t.ratio + '\n');
		});
		res.end();
	} else if (validator_re.test(pturl)) {
		var uuid = pturl.match(uuid_re)[0];
		var domain = pturl.match(domain_re)[0];
		var our_id = uuid + '@' + domain;
		var api_url = 'https://' + domain + '/api/v1/videos/' + uuid;
		console.log('Client wants video:', our_id);
		//console.log(api_url);
		if (our_id in torrents) {
			handler_part2(torrents[our_id]);
		} else {
			console.log('Requesting metadata!!!')
			request(api_url, meta_helper);
		}
	} else {
		error_404(res);
	}
}

server = http.createServer(handler);
server.listen(port, address);

console.log('Started server on', address, ':', port);
