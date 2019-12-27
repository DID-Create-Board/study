let express = require('express');
const ChromeLauncher = require('chrome-launcher');
let app = express();
let router = require('./router/main')(app);
// let port = 3000;

const ngrok = require('ngrok');

var static = require('serve-static');
// var path = require('path');

//config모듈을 사용
var dbconfig = require('./dbconfig');
var port = dbconfig.server_port || 5000;
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var expressSession = require('express-session');
//에러 핸들러 모듈 사용
var expressErrorHandler = require('express-error-handler');

//암호화 모듈
var crypto = require('crypto');

///passport 사용....사용자 인증 모듈, 인증 방식은 Strategy로 만들어져 있음
var passport = require('passport');
var flash = require('connect-flash');

//mongoose 모듈 사용... mongodb를 관계형데이터베이스처럼 사용
var mongoose = require('mongoose');

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(
  expressSession({
    secret: 'my key',
    resave: true,
    saveUninitialized: true,
  })
);

var database;
function connectDB() {
  mongoose.Promise = global.Promise;
  mongoose.connect(dbconfig.db_url);
  database = mongoose.connection;

  database.on('open', function() {
    console.log('데이터베이스에 연결됨 : ' + dbconfig.db_url);
    createUserShema(database);
  });

  database.on('disconnected', function() {
    console.log('데이터베이스 연결 끊어짐.');
  });

  database.on('error', console.error.bind('mongoose 연결 에러'));
  app.set('database', database);
}

function createUserShema(database) {
  database.UserSchema = require('./database/user_schema').createSchema(
    mongoose
  );
  database.UserModel = mongoose.model('users', database.UserSchema);
  console.log('UserModel 정의함.');
}

////Passport 초기화
app.use(passport.initialize()); //passport 초기화
app.use(passport.session()); //passport 초기화
app.use(flash());

///Passport Strategy 설정...local strategy를 이용하여 Passport 인증
var LocalStrategy = require('passport-local').Strategy;

passport.use(
  'local-login',
  new LocalStrategy(
    {
      usernameField: 'id',
      passwordField: 'password',
      passReqToCallback: true, //req으로 넘어간다.
    },
    function(req, id, password, done) {
      console.log('passort의 local-login 호출됨 : ' + id + ' , ' + password);

      //DB를 참조한다.
      process.nextTick(function() {
        var database = app.get('database');
        database.UserModel.findOne({ id: id }, function(err, user) {
          if (err) {
            console.log('에러 발생함.');
            return done(err);
          }
          if (!user) {
            console.log('사용자 id가 일치하지 않습니다.');
            return done(
              null,
              false,
              req.flash('loginMessage', '등록된 계정이 없습니다.')
            );
          }
          //유저스키마 정할때 저장 모수층이다.
          var authenticated = user.authenticate(
            password,
            user._doc.salt,
            user._doc.hash_password
          );
          if (!authenticated) {
            console.log('비밀번호가 일치하지 않습니다.');
            return done(
              null,
              false,
              req.flash('loginMessage'),
              '비밀번호가 일치하지 않습니다.'
            );
          }
          console.log('아이디와 비밀번호가 일치합니다.');
          return done(null, user);
        });
      });
    }
  )
);

passport.use(
  'local-signup',
  new LocalStrategy(
    {
      usernameField: 'id',
      passwordField: 'password',
      passReqToCallback: true,
    },
    function(req, id, password, done) {
      var paramName = req.body.name || req.query.name;

      console.log(
        'passport의 local-signup 호출됨 : ' +
          id +
          ' , ' +
          password +
          ' , ' +
          paramName
      );

      process.nextTick(function() {
        var database = app.get('database');
        database.UserModel.findOne({ id: id }, function(err, user) {
          if (err) {
            console.log('애러 발생.');
            return done(err);
          }
          if (user) {
            console.log('기존에 계정이 있습니다. ');
            return done(
              null,
              false,
              req.flash('signupMessage', '계정이 이미 있습니다.')
            );
          } else {
            var user = new database.UserModel({
              id: id,
              password: password,
              name: paramName,
            });
            user.save(function(err) {
              if (err) {
                console.log('데이터 베이스에 저장 시 에러.');
                return done(
                  null,
                  false,
                  req.flash(
                    'signupMessage',
                    '사용자 정보 저장 시 에러가 발생했습니다.'
                  )
                );
              }
              console.log('사용자 데이터 저장함');
              return done(null, user);
            });
          }
        });
      });
    }
  )
);

passport.serializeUser(function(user, done) {
  console.log('serializeUser 호출됨.');
  console.dir(user);

  done(null, user);
});

passport.deserializeUser(function(user, done) {
  console.log('deserializeUser 호출됨');
  console.dir(user);
  done(null, user);
});

var ser_router = express.Router();

//회원가입과 로그인 라우팅 함수
ser_router.route('/').get(function(req, res) {
  console.log('/패스로 요청됨.');
  res.render('index.html');
});
//화면을 보려면 get이 필수
ser_router.route('/login').get(function(req, res) {
  console.log('/login 패스로 GET 요청됨.');
  res.render('login.ejs', { message: req.flash('loginMessage') });
});
//로그인 요청해서 성공하면
ser_router.route('/login').post(
  passport.authenticate('local-login', {
    successRedirect: '/profile',
    failureRedirect: '/login',
    failureFlash: true,
  })
);
//화면을 보려면 get이 필수
ser_router.route('/signup').get(function(req, res) {
  console.log('/signup 패스로 GET 요청됨.');
  res.render('signup.ejs', { message: req.flash('signupMessage') });
});

//post까지는 잘 보내진다. 인증기관에서 문제 발견
ser_router.route('/signup').post(
  passport.authenticate('local-signup', {
    successRedirect: '/login',
    failureRedirect: '/profile',
    failureFlash: true,
  })
);

ser_router.route('/profile').get(function(req, res) {
  console.log('/profile 패스로 GET 요청됨.');
  console.log('req.user 객체 정보');
  console.dir(req.user);

  if (!req.user) {
    console.log('사용자 인증 안된 상태임.');
    res.redirect('/');
  } else {
    console.log('사용자 인증된 상태임.');

    if (Array.isArray(req.user)) {
      res.render('profile.ejs', { user: req.user[0]._doc });
    } else {
      res.render('profile.ejs', { user: req.user });
    }
  }
});

ser_router.route('/logout').get(function(req, res) {
  console.log('/logout 패스로 GET 요청됨.');
  req.logout();
  res.redirect('/');
});

app.use('/', ser_router);

//에러핸들러 사용.. 404 에러 페이지 처리
var errorHandler = expressErrorHandler({
  static: {
    '404': './public/404.html',
  },
});

app.use(expressErrorHandler.httpError(404));
app.use(errorHandler);

let server = app.listen(port, function() {
  console.log('Express server has started on port ' + port);
  connectDB();
});

// const server = app.listen(8088, () => {
//   ngrok.connect(8088).then(ngrokUrl => {
//     endpoint = ngrokUrl;
//     console.log(
//       `Your dApp is being served!, open at ${endpoint} and scan the QR to login!`
//     );
//   });
// });
