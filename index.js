module.exports = function (config) {
  (async () => {
    const fs = require('fs');
    const pg = require('pg');

    let options;
    try {
      options = JSON.parse(await fs.promises.readFile('config.json', 'utf8'));
    } catch (err) {
      console.log(err);
      return;
    }

    if (config.backend) {
      config.backend.welcomeText = `
        <h1 style="text-align: center;">KellPro Screeps</h1>
        <h2 style="text-align: center;">Tournament Server</h2>
        <div style="text-align: center;">Come hang out at our <a href="https://discord.gg/d87a98RneG">Discord Server</a> or check out the <a href="http://screeps.kellpro.com:21025/leaderboard">leaderboard</a>!</div>
      `;

      config.backend.on('expressPreConfig', async function (app) {
        app.get('/leaderboard', async function (req, res) {
          getDatabaseClient(async function (client) {
            const db = config.common.storage.db;
            const users = (await db.users.find())
              .filter(user => user.steam && user.username);
            const dataSize = 100;
            let scores = (await client.query(`
              WITH series AS (
                SELECT generate_series((SELECT MIN(created_date) FROM player_scores), (SELECT MAX(created_date) FROM player_scores), (SELECT (MAX(created_date) - MIN(created_date)) / 100 FROM player_scores)) AS date
              ),
              players AS (
                SELECT DISTINCT player_id FROM player_scores
              )
              SELECT players.player_id, series.date, player_scores.gcl
              FROM series
              CROSS JOIN players
              LEFT JOIN player_scores ON player_scores.id = (SELECT id FROM player_scores WHERE created_date > series.date AND player_id = players.player_id ORDER BY created_date LIMIT 1)
              ORDER BY players.player_id, series.date, player_scores.gcl
            `)).rows;
            const usersById = {};
            for (const user of users) {
              const userScore = scores.filter(score => score.player_id === user._id)[99];
              if (userScore) {
                userScore.player_id = user._id;
                userScore.date = new Date().toLocaleString();
                userScore.gcl = user.gcl;
              }

              usersById[user._id] = user;
            }
            for (const score of scores) {
              const user = usersById[score.player_id];
              score.username = (user && user.username);
            }
            scores = scores.filter(score => score.username);

            const tableUsers = JSON.parse(JSON.stringify(users));
            tableUsers.sort((a, b) => b.gcl - a.gcl);
            const rewardedPerTier = {};
            for (const tableUser of tableUsers) {
              for (const tier of options.tiers) {
                if (!tier.cap || tableUser.gcl <= tier.cap) {
                  tableUser.tier = tier;
                  break;
                }
              }
              if (tableUser.tier) {
                const tierIndex = options.tiers.indexOf(tableUser.tier);
                rewardedPerTier[tierIndex] = rewardedPerTier[tierIndex] || 0;
                tableUser.reward = tableUser.tier.rewards[rewardedPerTier[tierIndex]];
                rewardedPerTier[tierIndex] += 1;
              }
            }

            let html = `
              <style>
                table {
                  width: 100%;
                  max-width: 640px;
                  text-align: left;
                }
                table, th, td {
                  border: 1px solid black;
                }

                #chart {
                  width: 80%;
                }
              </style>

              <h1>KellPro Screeps Tournament Leaderboard</h1>
              <p>
                Come hang out at our <a href="https://discord.gg/d87a98RneG">Discord Server</a>!
              </p>

              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>GCL</th>
                    <th>Tier</th>
                    <th>Prize</th>
                  </tr>
                </thead>
                <tbody>
            `;

            for (const tableUser of tableUsers) {
              html += `
                <tr>
                  <td>${tableUser.username}</td>
                  <td>${(tableUser.gcl || 0).toLocaleString()}</td>
                  <td>${tableUser.tier.name}</td>
                  <td>$${(tableUser.reward || 0).toLocaleString()}.00</td>
                </tr>
              `;
            }

            html += `
                </tbody>
              </table>

              <hr>

              <div id="chart"></div>
              <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
              <script>
                const dataSize = ${dataSize};
                const scores = JSON.parse('${JSON.stringify(scores)}');
                const seriesObject = {};
                const datesObject = {};
                const playersById = {};
                for (const record of scores) {
                  record.date = new Date(record.date).toLocaleString();
                  if (!playersById[record.player_id]) {
                    playersById[record.player_id] = {
                      player_id: record.player_id,
                      username: record.username
                    };
                  }
                  seriesObject[record.player_id] = seriesObject[record.player_id] || [];
                  if (seriesObject[record.player_id].length >= dataSize) {
                    continue;
                  }
                  seriesObject[record.player_id].push(record.gcl);
                  datesObject[record.date] = true;
                }
                const dates = Object.keys(datesObject);
                const series = [];
                for (const playerId in seriesObject) {
                  const gcls = seriesObject[playerId];
                  series.push({
                    name: playersById[playerId].username,
                    data: gcls
                  });
                }
                console.log(series, dates);
                const chart = new ApexCharts(document.getElementById('chart'), {
                  chart: {
                    type: 'line'
                  },
                  series,
                  xaxis: {
                    categories: dates
                  }
                });
                chart.render();
              </script>
            `;
            res.header('Content-Type', 'text/html');
            res.send(html);
          });
        });
      });

      if (options.notify && options.notify.name && options.notify.password) {
        const ignoreError = await fs.promises.readFile(`${__dirname}/ignore-error.txt`, 'utf8');

        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport(`smtps://${options.notify.name}%40gmail.com:${options.notify.password}@smtp.gmail.com`);

        config.backend.on('sendUserNotifications', (user, notifications) => {
          if (!user.email) {
            return;
          }

          notifications = notifications.filter(notification => notification.message !== ignoreError);
          if (!notifications.length) {
            return;
          }

          const mailOptions = {
            from: `${options.notify.from_name} <${options.notify.name}@gmail.com>`,
            to: user.email,
            subject: `${options.notify.from_name} Notifications`
          };

          mailOptions.text = `${notifications.length} notifications received:\n\n`;

          for (const notification of notifications) {
            mailOptions.text += `${notification.message}\n[${notification.type}] (${notification.count})\n\n`;
          }

          transporter.sendMail(mailOptions, (error) => {
            if (error) {
              console.error(error);
            }
          });
        });
      }
    }

    if (config.cronjobs) {
      config.cronjobs.setPlayerDefaults = [5, async function () {
        const db = config.common.storage.db;
        const users = await db.users.find();
        for (const user of users) {
          if (user.steam && user.cpu !== 250) {
            await db.users.update({_id: user._id}, {$set: {cpu: 250, money: 250000000}});
          }
        }
      }];

      config.cronjobs.recordStats = [15, async function () {
        getDatabaseClient(async function (client) {
          const db = config.common.storage.db;
          const users = await db.users.find();
          for (const user of users) {
            if (user.steam) {
              await client.query(`INSERT INTO player_scores (player_id, gcl) VALUES ($1, $2)`, [user._id, user.gcl]);
            }
          }
          
          if (!(await db['rooms.objects'].findOne({type: 'terminal'})) && (await db['rooms'].find()).length > 400) {
            await db['rooms.objects'].insert({type: 'terminal', room: 'W0N0', x: 24, y: 24});
            await db['rooms.objects'].insert({type: 'terminal', room: 'E0N0', x: 24, y: 24});
            await db['rooms.objects'].insert({type: 'terminal', room: 'W0S0', x: 24, y: 24});
            await db['rooms.objects'].insert({type: 'terminal', room: 'E0S0', x: 24, y: 24});

            await client.query(`TRUNCATE player_scores`);
          }
        });
      }];
    }

    async function getDatabaseClient(callback) {
      if (options.pgPassword) {
        const client = new pg.Client({
          user: 'postgres',
          host: 'localhost',
          database: 'postgres',
          password: options.pgPassword,
          port: 5432
        });
        await client.connect();
        try {
          await callback(client);
        } finally {
          await client.end();
        }
      }
    }
  })();
};
