# Java web app (Maven → WAR → Tomcat) build template.
# Multi-stage: build the WAR from source with Maven, then deploy it to Tomcat 9
# at the ROOT context (served at "/"). Tomcat 9 keeps the javax.servlet
# namespace, which most classic Maven web apps target.

FROM maven:3.9-eclipse-temurin-17@sha256:1ed5d1f54416b706707b4f3238f63a20bb06aab27c6d240090a2bb9ad895ed45 AS build
WORKDIR /app
COPY . .
RUN mvn -q -DskipTests package

FROM tomcat:9.0@sha256:fb9ee094c9c3d985b39159a7289c5754a752e80f1204b51e3f4226a215934669
RUN rm -rf /usr/local/tomcat/webapps/*
COPY --from=build /app/target/*.war /usr/local/tomcat/webapps/ROOT.war
EXPOSE 8080
CMD ["catalina.sh", "run"]
